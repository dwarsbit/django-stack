import { randomBytes } from "node:crypto";

/** A URL-safe random secret with `bytes` bytes of randomness. */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** The secrets a project's .env needs, by the name used in `{{secret:<name>}}`. */
export function generateProjectSecrets(): Record<string, string> {
  return {
    django: generateSecret(48),
    postgres: generateSecret(24),
    api: generateSecret(32),
    api_read: generateSecret(32),
    preview: generateSecret(32),
    revalidate: generateSecret(32),
    admin: generateSecret(12),
    umami_app: generateSecret(32),
    umami_admin: generateSecret(24),
  };
}
