/**
 * Distransfer — Secure Upload/Download Engine (Parallel Pipeline v2)
 * 
 * All uploads go through our Cloudflare Worker API proxy.
 * Webhook URLs are NEVER present in client-side code.
 * The API handles Discord communication server-side.
 * 
 * Features:
 *   - Parallel upload pipeline: up to 5 chunks in-flight simultaneously
 *   - Proper 429 rate-limit handling with dynamic backoff
 *   - Parallel download: up to 6 concurrent chunk fetches
 *   - Real-time speed tracking
 */

import {
  CHUNK_SIZE,
  API_URL,
  MAX_PARALLEL_UPLOADS,
  MAX_PARALLEL_DOWNLOADS,
  DEFAULT_CONCURRENCY,
} from './constants';
import { sleep } from './utils';

// ─── Types ──────────────────────────────────────────────────

export type ProgressCallback = (uploaded: number, total: number) => void;

export interface UploadResult {
  /** CDN attachment URLs for each chunk, in order */
  urls: string[];
}

// ─── Worker info cache ──────────────────────────────────────

let _cachedConcurrency: number | null = null;

/**
 * Query the API to find out how many parallel webhook slots are available.
 * Cached for the session lifetime.
 */
async function getWorkerConcurrency(): Promise<number> {
  if (_cachedConcurrency !== null) return _cachedConcurrency;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_URL}/info`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { webhooks?: number };
      _cachedConcurrency = Math.min(data.webhooks || DEFAULT_CONCURRENCY, MAX_PARALLEL_UPLOADS);
      console.log(`[Distransfer] Server recommends concurrency=${_cachedConcurrency}`);
      return _cachedConcurrency;
    }
  } catch {
    console.warn('[Distransfer] Could not reach /info, using default concurrency');
  }

  _cachedConcurrency = DEFAULT_CONCURRENCY;
  return _cachedConcurrency;
}

// ─── File reader helper ─────────────────────────────────────

function readChunk(file: File, offset: number, chunkSize: number): Promise<ArrayBuffer> {
  const blob = file.slice(offset, offset + chunkSize);
  return blob.arrayBuffer();
}

// ─── Download helpers (CORS bypass via API) ──────────────────

export async function fetchUrl(url: string): Promise<Blob> {
  // 1. Try direct fetch (works for some CDN URLs)
  try {
    const directRes = await fetch(url);
    if (directRes.ok) return await directRes.blob();
  } catch {
    // CORS blocked — expected
  }

  // 2. Fallback to our secure API proxy
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${API_URL}/download?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) return await res.blob();
      
      const errorData = await res.json().catch(() => ({}));
      throw new Error((errorData as { error?: string }).error || `Proxy error ${res.status}`);
    } catch (e) {
      lastError = e as Error;
      if (attempt < 3) await sleep(1500);
    }
  }
  throw lastError || new Error('Failed to fetch file chunk');
}

/**
 * Download multiple chunk URLs in parallel with controlled concurrency.
 * Returns chunks as ordered ArrayBuffers.
 */
export async function downloadChunksParallel(
  urls: string[],
  onBytesDownloaded?: (totalDownloaded: number) => void,
): Promise<ArrayBuffer[]> {
  const concurrency = Math.min(MAX_PARALLEL_DOWNLOADS, urls.length);
  const results: ArrayBuffer[] = new Array(urls.length);
  let totalDownloaded = 0;
  let nextIndex = 0;

  const activeWorkers: Promise<void>[] = [];

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= urls.length) return;

      const blob = await fetchUrl(urls[i]);
      const data = await blob.arrayBuffer();
      results[i] = data;
      totalDownloaded += data.byteLength;
      if (onBytesDownloaded) onBytesDownloaded(totalDownloaded);
    }
  };

  // Launch worker pool
  for (let w = 0; w < concurrency; w++) {
    activeWorkers.push(worker());
  }

  await Promise.all(activeWorkers);
  return results;
}

// ─── Secure Upload via API ──────────────────────────────────

/**
 * Upload a single chunk through the API proxy.
 * The API forwards it to Discord and returns the CDN attachment URL.
 * 
 * Handles 429 (rate limit) separately from other errors:
 * - 429: wait and retry (doesn't count toward error retries)
 * - Other errors: exponential backoff with limited retries
 */
async function uploadChunk(
  filename: string,
  blob: Blob,
  webhookIndex: number,
  errorRetries = 0,
  rateLimitRetries = 0,
): Promise<string> {
  if (errorRetries > 8) throw new Error('Max retries exceeded.');
  if (rateLimitRetries > 15) throw new Error('Too many rate limits. Try again later.');

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('webhook_index', String(webhookIndex));

  try {
    const res = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (res.status === 429) {
      // Rate limited — wait and retry (does NOT count as error retry)
      let retryAfter = 5;
      try {
        const data = await res.json() as { retryAfter?: number };
        retryAfter = data.retryAfter || 5;
      } catch { /* ignore */ }
      
      const waitTime = (retryAfter + rateLimitRetries * 2) * 1000;
      console.warn(`[Distransfer] Rate limited, waiting ${(waitTime / 1000).toFixed(0)}s (attempt ${rateLimitRetries + 1})...`);
      await sleep(waitTime);
      return uploadChunk(filename, blob, webhookIndex, errorRetries, rateLimitRetries + 1);
    }

    if (res.status === 502 || res.status === 503) {
      // Worker overloaded or timed out — wait longer before retrying.
      // Cloudflare returns 503 when the Worker exceeds its execution time limit.
      const waitTime = (8 + errorRetries * 5) * 1000;
      console.warn(`[Distransfer] Server overloaded (${res.status}), waiting ${(waitTime / 1000).toFixed(0)}s...`);
      await sleep(waitTime);
      return uploadChunk(filename, blob, webhookIndex, errorRetries + 1, rateLimitRetries);
    }

    const data = await res.json() as { url?: string; error?: string };

    if (!res.ok) {
      throw new Error(data.error || `API error ${res.status}`);
    }

    if (!data.url) {
      throw new Error('No attachment URL returned from API');
    }

    return data.url;
  } catch (e: unknown) {
    const err = e as Error;
    // "Failed to fetch" = network error, CORS error, or worker crashed
    if (errorRetries < 8) {
      const waitTime = Math.pow(2, errorRetries) * 1000 + Math.random() * 2000;
      console.warn(`[Distransfer] Upload error (attempt ${errorRetries + 1}): ${err.message}, retrying in ${(waitTime / 1000).toFixed(0)}s...`);
      await sleep(waitTime);
      return uploadChunk(filename, blob, webhookIndex, errorRetries + 1, rateLimitRetries);
    }
    throw e;
  }
}

/**
 * Upload a file by splitting into chunks and uploading them in PARALLEL.
 * Uses a sliding-window pipeline: maintains up to N concurrent uploads,
 * where N = server-recommended concurrency (typically 5).
 * Each chunk is round-robined to a different webhook index.
 * Returns an array of CDN attachment URLs (one per chunk, in order).
 */
export async function uploadFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const urls: string[] = new Array(totalChunks).fill('');
  let uploadedBytes = 0;

  // Query server for recommended concurrency
  const concurrency = await getWorkerConcurrency();

  console.log(
    `[Distransfer] Upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB, ` +
    `${totalChunks} chunks, concurrency=${concurrency})`
  );

  if (onProgress) onProgress(0, file.size);

  // ─── Parallel pipeline (sliding window) ─────────────────
  const activeUploads = new Set<Promise<void>>();
  let nextChunkIndex = 0;
  let hasError: Error | null = null;

  const launchChunk = async (chunkIndex: number) => {
    const offset = chunkIndex * CHUNK_SIZE;
    const chunkLabel = `${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_chunk_${chunkIndex}`;

    // Use chunk index for webhook round-robin (across ALL 15 webhooks, not just concurrency)
    const webhookIdx = chunkIndex;

    const startTime = Date.now();
    console.log(`[Distransfer] ⬆ Chunk ${chunkIndex}/${totalChunks - 1} → webhook[${webhookIdx % 15}]...`);

    // Read chunk from file
    const chunkBuffer = await readChunk(file, offset, CHUNK_SIZE);
    const chunkBlob = new Blob([chunkBuffer]);

    // Upload through API
    const url = await uploadChunk(chunkLabel, chunkBlob, webhookIdx);
    urls[chunkIndex] = url;

    // Track progress
    uploadedBytes += chunkBuffer.byteLength;
    if (onProgress) onProgress(uploadedBytes, file.size);

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = (chunkBuffer.byteLength / 1024 / 1024) / Math.max(elapsed, 0.1);
    console.log(`[Distransfer] ✓ Chunk ${chunkIndex} done (${speed.toFixed(1)} MB/s)`);
  };

  // Fill the pipeline with staggered launches
  while (nextChunkIndex < totalChunks && !hasError) {
    // Fill slots up to concurrency
    while (activeUploads.size < concurrency && nextChunkIndex < totalChunks) {
      const i = nextChunkIndex;
      nextChunkIndex++;

      // Track the promise lifecycle
      const tracked = launchChunk(i)
        .catch((err) => {
          hasError = err as Error;
        })
        .finally(() => {
          activeUploads.delete(tracked);
        });

      activeUploads.add(tracked);

      // Stagger between launches to avoid overwhelming the Worker
      if (activeUploads.size < concurrency && nextChunkIndex < totalChunks) {
        await sleep(500);
      }
    }

    // Wait for at least one slot to free up
    if (activeUploads.size > 0) {
      await Promise.race(activeUploads);
    }

    // Check for errors
    if (hasError) break;
  }

  // Wait for remaining in-flight uploads
  if (activeUploads.size > 0) {
    await Promise.allSettled(activeUploads);
  }

  // Re-throw if any chunk failed
  if (hasError) {
    throw hasError;
  }

  // Verify all URLs are present
  for (let i = 0; i < urls.length; i++) {
    if (!urls[i]) throw new Error(`Upload failed: chunk ${i} has no URL`);
  }

  console.log(`[Distransfer] ✓ Upload complete: ${urls.length} chunks (concurrency=${concurrency})`);
  return { urls };
}

/**
 * Upload a manifest (for large multi-file transfers).
 * Returns the CDN URL of the uploaded manifest.
 */
export async function uploadManifest(data: Uint8Array): Promise<string> {
  const url = await uploadChunk('manifest.bin', new Blob([data.buffer as ArrayBuffer]), 0);
  return url;
}
