// Chunk size: 9.99MB — max under Discord's 10MB webhook file limit
export const CHUNK_SIZE = Math.floor(9.99 * 1024 * 1024);

// Secure upload/download API (Cloudflare Worker — webhook URLs are stored as encrypted secrets)
export const API_URL = 'https://distransfer-api.distock-proxy.workers.dev';

// ─── Parallel pipeline settings ──────────────────────────────

// Max concurrent uploads — 3 is optimal: fast AND avoids Discord rate limits.
// More concurrent = more 429 errors = actually SLOWER due to retry pauses.
export const MAX_PARALLEL_UPLOADS = 3;

// Max concurrent downloads (browser limits ~6 connections per domain)
export const MAX_PARALLEL_DOWNLOADS = 6;

// Fallback concurrency if /info endpoint is unavailable
export const DEFAULT_CONCURRENCY = 3;
