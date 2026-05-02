/**
 * Distransfer — Share Link Encoder/Decoder
 * 
 * Encodes file metadata + CDN URLs into a compact shareable link.
 * For small transfers: data is embedded directly in the URL hash.
 * For large transfers (many chunks): a manifest is uploaded to Discord and the link references it.
 */

import pako from 'pako';
import { uploadManifest, fetchUrl } from './discord-storage';

export interface TransferFile {
  name: string;
  size: number;
  urls: string[];
}

export interface TransferManifest {
  version: 1;
  files: TransferFile[];
  totalSize: number;
  createdAt: string;
}

/**
 * Generate a shareable link for the given files.
 * Returns the full URL that recipients can use to download.
 */
export async function generateShareLink(files: TransferFile[]): Promise<string> {
  const manifest: TransferManifest = {
    version: 1,
    files,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    createdAt: new Date().toISOString(),
  };

  const json = JSON.stringify(manifest);
  const compressed = pako.deflate(json);

  // Check if the compressed data fits in a URL (< 4KB for safety)
  const base64 = arrayBufferToBase64Url(compressed);

  if (base64.length < 4000) {
    // Small transfer: embed directly in URL hash
    const baseUrl = getBaseUrl();
    return `${baseUrl}#/download?data=${base64}`;
  } else {
    // Large transfer: upload manifest to Discord, put manifest URL in link
    const manifestUrl = await uploadManifest(compressed);
    const baseUrl = getBaseUrl();
    return `${baseUrl}#/download?manifest=${encodeURIComponent(manifestUrl)}`;
  }
}

/**
 * Decode a share link and return the transfer manifest.
 */
export async function decodeShareLink(search: string): Promise<TransferManifest> {
  const params = new URLSearchParams(search);

  // Case 1: Manifest URL (large transfers)
  if (params.has('manifest')) {
    const manifestUrl = params.get('manifest')!;
    const blob = await fetchUrl(manifestUrl);
    const buffer = await blob.arrayBuffer();
    const decompressed = pako.inflate(new Uint8Array(buffer), { to: 'string' });
    return JSON.parse(decompressed) as TransferManifest;
  }

  // Case 2: Data embedded in URL (small transfers)
  if (params.has('data')) {
    const base64 = params.get('data')!;
    const bytes = base64UrlToArrayBuffer(base64);
    const decompressed = pako.inflate(bytes, { to: 'string' });
    return JSON.parse(decompressed) as TransferManifest;
  }

  throw new Error('Invalid share link — no data found.');
}

// ─── Encoding helpers ──────────────────────────────────────

function arrayBufferToBase64Url(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '~')
    .replace(/\//g, '_')
    .replace(/=/g, '-');
}

function base64UrlToArrayBuffer(base64url: string): Uint8Array {
  const base64 = base64url
    .replace(/~/g, '+')
    .replace(/_/g, '/')
    .replace(/-/g, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getBaseUrl(): string {
  const loc = window.location;
  return `${loc.protocol}//${loc.host}${loc.pathname}`;
}
