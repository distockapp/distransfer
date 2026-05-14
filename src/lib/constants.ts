// Chunk size: 9.99MB — max under Discord's 10MB webhook file limit
export const CHUNK_SIZE = Math.floor(9.99 * 1024 * 1024);

// Secure upload/download API (Cloudflare Worker — webhook URLs are stored as encrypted secrets)
export const API_URL = 'https://distransfer-api.distock-proxy.workers.dev';

// ─── Parallel pipeline settings ──────────────────────────────

// Max concurrent uploads — 2 is the sweet spot: avoids Discord rate-limit cascades
// that cause speed to collapse after ~200 MB.  The adaptive throttle may lower this
// to 1 at runtime if it detects heavy rate-limiting.
export const MAX_PARALLEL_UPLOADS = 2;

// Max concurrent downloads (browser limits ~6 connections per domain)
export const MAX_PARALLEL_DOWNLOADS = 6;

// Fallback concurrency if /info endpoint is unavailable
export const DEFAULT_CONCURRENCY = 2;

// ─── Adaptive throttle settings ──────────────────────────────

// Minimum pause (ms) between launching successive chunk uploads.
// Prevents flooding Discord even when no rate-limit has been seen yet.
export const MIN_INTER_CHUNK_DELAY = 300;

// Extra pause (ms) applied after the pipeline receives a 429 from Discord.
// This gives Discord time to reset its rate-limit window.
export const RATE_LIMIT_COOLDOWN = 3000;

// Number of consecutive clean chunks (no 429) before the throttle relaxes.
export const THROTTLE_RELAX_AFTER = 8;
