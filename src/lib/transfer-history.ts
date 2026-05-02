/**
 * Distransfer — Transfer History Manager
 * 
 * Persists transfer records in localStorage so users can
 * review and manage their past transfers.
 */

const STORAGE_KEY = 'distransfer_history';

export interface TransferRecord {
  /** Unique ID for this transfer */
  id: string;
  /** Files included in the transfer */
  files: { name: string; size: number }[];
  /** Total size in bytes */
  totalSize: number;
  /** The shareable link */
  link: string;
  /** ISO timestamp of creation */
  createdAt: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Load all transfer records from localStorage (most recent first).
 */
export function getTransferHistory(): TransferRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw) as TransferRecord[];
    // Sort most recent first
    return records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

/**
 * Add a new transfer record to history.
 */
export function addTransferRecord(
  files: { name: string; size: number }[],
  link: string,
): TransferRecord {
  const record: TransferRecord = {
    id: generateId(),
    files,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    link,
    createdAt: new Date().toISOString(),
  };

  const history = getTransferHistory();
  history.unshift(record);

  // Keep max 100 records
  const trimmed = history.slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));

  return record;
}

/**
 * Delete a single transfer record by ID.
 */
export function deleteTransferRecord(id: string): void {
  const history = getTransferHistory();
  const updated = history.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/**
 * Delete all transfer records.
 */
export function clearTransferHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
