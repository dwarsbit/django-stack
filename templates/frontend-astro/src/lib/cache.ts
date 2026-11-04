/**
 * A small in-memory cache of rendered pages. Django calls /revalidate after
 * editors change content, which empties it; entries also expire after
 * CACHE_TTL seconds (default 300). One frontend process, one cache: with
 * several replicas, put a shared cache or CDN in front instead.
 */

interface Entry {
  body: string;
  status: number;
  headers: [string, string][];
  expires: number;
}

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES ?? 500);
const TTL = Number(process.env.CACHE_TTL ?? 300) * 1000;
const entries = new Map<string, Entry>();

export function getCached(key: string): Response | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    entries.delete(key);
    return null;
  }
  // Move to the end: the oldest entries are evicted first.
  entries.delete(key);
  entries.set(key, entry);
  const headers = new Headers(entry.headers);
  headers.set("X-Cache", "HIT");
  return new Response(entry.body, { status: entry.status, headers });
}

export async function store(key: string, response: Response): Promise<Response> {
  if (TTL <= 0) return response;
  const body = await response.text();
  entries.set(key, {
    body,
    status: response.status,
    headers: [...response.headers.entries()].filter(([name]) => name.toLowerCase() !== "set-cookie"),
    expires: Date.now() + TTL,
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  const headers = new Headers(response.headers);
  headers.set("X-Cache", "MISS");
  return new Response(body, { status: response.status, headers });
}

/** Empties the cache; returns the number of entries removed. */
export function purgeAll(): number {
  const size = entries.size;
  entries.clear();
  return size;
}
