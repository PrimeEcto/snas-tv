/**
 * Best-effort response cache backed by Supabase Postgres over PostgREST.
 *
 * The upstream source API rate-limits aggressively (HTTP 429 after only a handful
 * of requests), so decrypted payloads are stored server-side and reused. Supabase
 * is the durable 24/7 store; the Worker reaches it with the service role key over
 * HTTPS and never with a SQL driver.
 *
 * Caching is strictly best-effort. With no credentials, or on any network/HTTP
 * failure, reads miss and writes are dropped: a request must never fail because
 * the cache did.
 */
import type { FetchLike } from './movy.ts';

export interface CacheEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface CacheRecord<T> {
  value: T;
  storedAt: number;
  expiresAt: number;
}

export interface Cache {
  get<T>(key: string): Promise<CacheRecord<T> | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface CacheOptions {
  fetchImpl?: FetchLike;
  table?: string;
  namespace?: string;
  now?: () => number;
  timeoutMs?: number;
}

const DEFAULT_TABLE = 'movy_stream_cache';
const DEFAULT_NAMESPACE = 'movy';
const DEFAULT_TIMEOUT_MS = 5000;

/** Shape of a PostgREST row for the cache tables. */
interface CacheRow<T> {
  value?: T;
  stored_at?: string;
  expires_at?: string;
}

/** Cache used when Supabase is not configured: always a miss, never a request. */
function noopCache(): Cache {
  return {
    async get<T>(): Promise<CacheRecord<T> | null> {
      return null;
    },
    async set(): Promise<void> {
      // No cache configured; the caller's data is simply not persisted.
    },
  };
}

/**
 * Build a stable, PostgREST-query-safe cache key from path segments.
 * Nullish and empty parts are dropped, so optional season/episode can be passed
 * through directly.
 */
export function cacheKey(parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((part) => part !== undefined && part !== null && `${part}`.trim() !== '')
    .map((part) => `${part}`.trim().toLowerCase())
    .join(':')
    .replace(/[^a-z0-9._:-]/g, '-');
}

/**
 * Create a cache handle for one table. When `SUPABASE_URL` or the service role key
 * is missing the handle is a no-op, so callers can use it unconditionally.
 */
export function createCache(env: CacheEnv, options: CacheOptions = {}): Cache {
  const baseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) return noopCache();

  const table = options.table ?? DEFAULT_TABLE;
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const endpoint = `${baseUrl}/rest/v1/${table}`;
  // The service role key stays in this closure; it is never logged or returned.
  const headers: Record<string, string> = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  };
  const scoped = (key: string): string => `${namespace}:${key}`;

  return {
    async get<T>(key: string): Promise<CacheRecord<T> | null> {
      try {
        const url = `${endpoint}?key=eq.${encodeURIComponent(scoped(key))}`
          + '&select=value,stored_at,expires_at&limit=1';
        const response = await fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const rows = (await response.json()) as CacheRow<T>[];
        const row = Array.isArray(rows) ? rows[0] : undefined;
        if (!row) return null;
        const storedAt = Date.parse(row.stored_at ?? '');
        const expiresAt = Date.parse(row.expires_at ?? '');
        if (!Number.isFinite(expiresAt) || expiresAt <= now()) return null;
        return {
          value: row.value as T,
          storedAt: Number.isFinite(storedAt) ? storedAt : 0,
          expiresAt,
        };
      } catch {
        // A miss on failure is the safe outcome: the caller re-fetches upstream.
        return null;
      }
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      try {
        const stamp = now();
        await fetchImpl(endpoint, {
          method: 'POST',
          headers: { ...headers, prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({
            key: scoped(key),
            value,
            stored_at: new Date(stamp).toISOString(),
            expires_at: new Date(stamp + ttlSeconds * 1000).toISOString(),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Writes are best-effort; a cache failure must not fail the request.
      }
    },
  };
}
