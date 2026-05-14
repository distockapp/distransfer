// Chunk size: 9.99MB — max under Discord's 10MB webhook file limit
export const CHUNK_SIZE = Math.floor(9.99 * 1024 * 1024);

// Secure upload/download API (Cloudflare Worker — webhook URLs are stored as encrypted secrets)
export const API_URL = 'https://distransfer-api.distock-proxy.workers.dev';

// ─── Parallel pipeline settings ──────────────────────────────

// Max concurrent uploads.
// With 15 webhooks round-robined, Discord rate-limits are per-webhook (~5msg/5s).
// 5 concurrent uploads across 15 webhooks = each webhook gets hit every 3 chunks
// → stays well within per-webhook limits.
export const MAX_PARALLEL_UPLOADS = 5;

// Max concurrent downloads (browser limits ~6 connections per domain)
export const MAX_PARALLEL_DOWNLOADS = 6;

// Fallback concurrency if /info endpoint is unavailable
export const DEFAULT_CONCURRENCY = 5;
