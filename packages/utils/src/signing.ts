/**
 * HMAC signatures shared with the django-stack Python package.
 *
 * Preview tokens are `<expires>.<signature>`: the hex HMAC-SHA256 of
 * `preview.<expires>` with the preview secret, `expires` in Unix seconds.
 *
 * Webhook signatures are the header `t=<timestamp>,v1=<signature>`: the hex
 * HMAC-SHA256 of `<timestamp>.<raw body>`, as Django Content Studio signs
 * its webhooks.
 */

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings in constant time for strings of the same length. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A preview token valid for `maxAge` seconds. */
export async function signPreviewToken(secret: string, maxAge = 3600, now = nowSeconds()): Promise<string> {
  const expires = Math.floor(now + maxAge);
  return `${expires}.${await hmacHex(secret, `preview.${expires}`)}`;
}

/** Whether `token` is a preview token signed with `secret` that has not expired. */
export async function verifyPreviewToken(
  secret: string | undefined,
  token: string | null | undefined,
  now = nowSeconds(),
): Promise<boolean> {
  if (!secret || !token) return false;
  const [expires, signature, ...rest] = token.split(".");
  if (!expires || !signature || rest.length > 0 || !/^\d+$/.test(expires)) return false;
  const expected = await hmacHex(secret, `preview.${expires}`);
  return timingSafeEqual(expected, signature) && Number(expires) >= now;
}

/** The signature header of a webhook body. */
export async function signWebhook(secret: string, body: string, timestamp = nowSeconds()): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`;
}

export interface VerifyWebhookOptions {
  /** Seconds a signature stays valid, against replays. Default 300. */
  tolerance?: number;
  /** The signature header. Default `X-Django-Stack-Signature`. */
  header?: string;
  now?: number;
}

/** Whether a raw body and its signature header were signed with `secret`. */
export async function verifySignature(
  secret: string | undefined,
  header: string | null | undefined,
  body: string,
  { tolerance = 300, now = nowSeconds() }: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (!secret || !header) return false;
  const fields = new Map(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestamp = Number(fields.get("t"));
  const signature = fields.get("v1");
  if (!Number.isInteger(timestamp) || !signature) return false;
  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return Math.abs(now - timestamp) <= tolerance && timingSafeEqual(expected, signature);
}

export interface VerifiedWebhook<T = unknown> {
  valid: boolean;
  payload: T | null;
}

/**
 * Verifies a webhook `Request` from Django and parses its JSON body. Reads
 * the body, so pass the original request, not one whose body was read.
 */
export async function verifyWebhook<T = WebhookPayload>(
  request: Request,
  secret: string | undefined,
  options: VerifyWebhookOptions = {},
): Promise<VerifiedWebhook<T>> {
  const body = await request.text();
  const header = request.headers.get(options.header ?? "X-Django-Stack-Signature");
  if (!(await verifySignature(secret, header, body, options))) return { valid: false, payload: null };
  try {
    return { valid: true, payload: JSON.parse(body) as T };
  } catch {
    return { valid: false, payload: null };
  }
}

/** The body Django sends to the frontend's revalidate endpoint. */
export interface WebhookPayload {
  version: number;
  event: "content.changed" | string;
  changes: { action: string; model: string | null; id: string | null }[];
}
