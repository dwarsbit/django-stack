/**
 * A small in-memory cache of the content the pages load. Django calls
 * /revalidate after editors change content, which empties it; entries also
 * expire after CACHE_TTL seconds (default 300). One frontend process, one
 * cache: with several replicas, put a shared cache or CDN in front instead.
 */

const MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES ?? 500);
const TTL = Number(process.env.CACHE_TTL ?? 300) * 1000;
const entries = new Map<string, { value: unknown; expires: number }>();

export function getCached<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    entries.delete(key);
    return undefined;
  }
  // Move to the end: the oldest entries are evicted first.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value as T;
}

export function store<T>(key: string, value: T): T {
  if (TTL <= 0) return value;
  entries.set(key, { value, expires: Date.now() + TTL });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return value;
}

/** The cached value for key, or the result of load, which is then cached. */
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== undefined) return hit;
  return store(key, await load());
}

/** Empties the cache; returns the number of entries removed. */
export function purgeAll(): number {
  const size = entries.size;
  entries.clear();
  return size;
}
