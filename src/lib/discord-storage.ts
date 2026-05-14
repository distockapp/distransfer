/**
 * Distransfer — Secure Upload/Download Engine (Parallel Pipeline v4)
 * 
 * All uploads go through our Cloudflare Worker API proxy.
 * Webhook URLs are NEVER present in client-side code.
 * The API handles Discord communication server-side.
 * 
 * Features:
 *   - 5 concurrent chunk uploads across 15 webhooks (round-robin)
 *   - Natural backpressure: 429 retries inside uploadChunk slow down
 *     the pipeline automatically without artificial throttling
 *   - Parallel download: up to 6 concurrent chunk fetches
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

export async function fetchUrl(url: string, transferId?: string, token?: string): Promise<Blob> {
  // 1. Try direct fetch (works for some CDN URLs)
  // Only use direct fetch if we don't have a transferId/token, since direct fetch won't trigger the logger
  if (!transferId && !token) {
    try {
      const directRes = await fetch(url);
      if (directRes.ok) return await directRes.blob();
    } catch {
      // CORS blocked — expected
    }
  }

  // 2. Fallback to our secure API proxy
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      let proxyUrl = `${API_URL}/download?url=${encodeURIComponent(url)}`;
      if (transferId) proxyUrl += `&transferId=${encodeURIComponent(transferId)}`;
      
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(proxyUrl, {
        headers,
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
  transferId?: string,
  token?: string
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

      const blob = await fetchUrl(urls[i], transferId, token);
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
 * - 429: wait the indicated time and retry (doesn't count toward error retries)
 * - Other errors: exponential backoff with limited retries
 * 
 * The wait times on 429 provide NATURAL backpressure on the pipeline:
 * when Discord rate-limits, the in-flight chunk takes longer, which means
 * fewer concurrent uploads are active → throughput self-regulates.
 */
async function uploadChunk(
  filename: string,
  blob: Blob,
  webhookIndex: number,
  errorRetries = 0,
  rateLimitRetries = 0,
): Promise<string> {
  if (errorRetries > 8) throw new Error('Max retries exceeded.');
  if (rateLimitRetries > 20) throw new Error('Too many rate limits. Try again later.');

  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('webhook_index', String(webhookIndex));

  try {
    const res = await fetch(`${API_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (res.status === 429) {
      // Rate limited — wait the indicated time and retry
      let retryAfter = 3;
      try {
        const data = await res.json() as { retryAfter?: number };
        retryAfter = data.retryAfter || 3;
      } catch { /* ignore */ }
      
      // Linear backoff: retryAfter + 1s per previous rate-limit on this chunk
      const waitTime = (retryAfter + rateLimitRetries) * 1000;
      console.warn(`[Distransfer] 429 on chunk, waiting ${(waitTime / 1000).toFixed(0)}s (rl attempt ${rateLimitRetries + 1})...`);
      await sleep(waitTime);
      return uploadChunk(filename, blob, webhookIndex, errorRetries, rateLimitRetries + 1);
    }

    if (res.status === 502 || res.status === 503) {
      const waitTime = (5 + errorRetries * 3) * 1000;
      console.warn(`[Distransfer] Server error (${res.status}), waiting ${(waitTime / 1000).toFixed(0)}s...`);
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
 * Upload a file by splitting into chunks and uploading them in parallel.
 * 
 * Uses a worker-pool pattern with N concurrent "workers", each pulling
 * the next chunk index from a shared counter. This is simpler and faster
 * than the previous sliding-window approach:
 *   - No artificial delays between chunk launches
 *   - No adaptive throttle that over-corrects and kills throughput
 *   - Natural backpressure: when a chunk hits a 429, that worker is busy
 *     waiting → fewer active workers → throughput self-regulates
 *   - Each chunk round-robins to a different webhook (15 total), so
 *     per-webhook rate limits (5msg/5s) are rarely hit
 */
export async function uploadFile(
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadResult> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const urls: string[] = new Array(totalChunks).fill('');
  let uploadedBytes = 0;
  let rateLimitCount = 0;

  const concurrency = await getWorkerConcurrency();

  console.log(
    `[Distransfer] Upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB, ` +
    `${totalChunks} chunks, concurrency=${concurrency})`
  );

  if (onProgress) onProgress(0, file.size);

  // ─── Worker pool ────────────────────────────────────────
  let nextChunkIndex = 0;
  let hasError: Error | null = null;

  const uploadWorker = async (): Promise<void> => {
    while (!hasError) {
      const chunkIndex = nextChunkIndex++;
      if (chunkIndex >= totalChunks) return;

      const offset = chunkIndex * CHUNK_SIZE;
      const chunkLabel = `${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}_chunk_${chunkIndex}`;
      const webhookIdx = chunkIndex; // round-robin across all 15 webhooks

      const startTime = Date.now();

      try {
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
        console.log(`[Distransfer] ✓ Chunk ${chunkIndex}/${totalChunks - 1} done (${speed.toFixed(1)} MB/s, wh[${webhookIdx % 15}])`);
      } catch (err) {
        hasError = err as Error;
        return;
      }
    }
  };

  // Launch worker pool — all workers start immediately
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(uploadWorker());
  }

  await Promise.allSettled(workers);

  if (hasError) {
    throw hasError;
  }

  // Verify all URLs are present
  for (let i = 0; i < urls.length; i++) {
    if (!urls[i]) throw new Error(`Upload failed: chunk ${i} has no URL`);
  }

  console.log(`[Distransfer] ✓ Upload complete: ${urls.length} chunks, concurrency=${concurrency}`);
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
