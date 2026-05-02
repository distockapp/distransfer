import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, AlertTriangle, Loader2, Zap } from 'lucide-react';
import { formatSize, getFileIcon } from '../lib/utils';
import { decodeShareLink, type TransferManifest } from '../lib/link-encoder';
import { fetchUrl, downloadChunksParallel } from '../lib/discord-storage';
import { toast } from 'sonner';
import JSZip from 'jszip';

export function DownloadPage() {
  const location = useLocation();
  const [manifest, setManifest] = useState<TransferManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProtected, setIsProtected] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [verifyError, setVerifyError] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => sessionStorage.getItem('distransfer_jwt'));
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0); // bytes per second
  const speedRef = useRef({ lastBytes: 0, lastTime: Date.now() });

  useEffect(() => {
    const load = async () => {
      try {
        const search = location.search;
        const data = await decodeShareLink(search);
        setManifest(data);

        // Check if protected
        if (data.transferId) {
          try {
            const statusRes = await fetch(`${import.meta.env.VITE_API_URL || 'https://distransfer-api.distockapp.workers.dev'}/transfer/status?transferId=${data.transferId}`);
            if (statusRes.ok) {
              const status = await statusRes.json();
              // If it's protected and we don't have a token, we must lock it.
              // If we do have a token, we might still be locked if the token is expired/invalid,
              // but we'll optimisticly unlock and let the download fail/refresh later.
              if (status.protected && !sessionStorage.getItem('distransfer_jwt')) {
                setIsProtected(true);
                setIsLocked(true);
              } else if (status.protected) {
                setIsProtected(true);
                setIsLocked(false);
              }
            }
          } catch (e) {
            console.error('[Distransfer] Error checking transfer status:', e);
          }
        }
      } catch (e: unknown) {
        const err = e as Error;
        console.error('[Distransfer] Failed to decode link:', err);
        setError("Ce lien de transfert est invalide ou expiré. Vérifiez que vous avez copié le lien entier.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [location]);

  // Speed calculation helper
  const updateSpeed = (totalDownloaded: number) => {
    const now = Date.now();
    const elapsed = (now - speedRef.current.lastTime) / 1000;
    if (elapsed >= 0.5) { // Update speed every 500ms
      const byteDiff = totalDownloaded - speedRef.current.lastBytes;
      setSpeed(byteDiff / elapsed);
      speedRef.current = { lastBytes: totalDownloaded, lastTime: now };
    }
  };

  const downloadSingleFile = async (file: { name: string; size: number; urls: string[] }) => {
    // Single chunk — fast path
    if (file.urls.length === 1) {
      try {
        const blob = await fetchUrl(file.urls[0], manifest?.transferId, authToken || undefined);
        triggerDownload(blob, file.name);
        return;
      } catch {
        // Fallback to direct download if proxy fails
        const a = document.createElement('a');
        a.href = file.urls[0];
        a.download = file.name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
      }
    }

    // Multi-chunk: parallel download + reassemble
    // @ts-ignore
    if (window.showSaveFilePicker) {
      try {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({ suggestedName: file.name });
        const writable = await handle.createWritable();

        // Download all chunks in parallel
        const chunks = await downloadChunksParallel(file.urls, (downloaded) => {
          setProgress((downloaded / Math.max(downloaded, file.size)) * 100);
          updateSpeed(downloaded);
        }, manifest?.transferId, authToken || undefined);

        // Write in order
        for (const chunk of chunks) {
          await writable.write(new Uint8Array(chunk));
        }
        await writable.close();
        return;
      } catch (e: unknown) {
        const err = e as Error;
        if (err.name === 'AbortError') return;
        // Fall through to blob approach
      }
    }

    // Fallback: parallel download to memory then trigger
    const chunks = await downloadChunksParallel(file.urls, (downloaded) => {
      setProgress((downloaded / Math.max(downloaded, file.size)) * 100);
      updateSpeed(downloaded);
    }, manifest?.transferId, authToken || undefined);

    const finalBlob = new Blob(chunks.map(buf => new Uint8Array(buf)));
    triggerDownload(finalBlob, file.name);
  };

  const handleDownload = async () => {
    if (!manifest) return;
    setIsDownloading(true);
    setProgress(0);
    setSpeed(0);
    speedRef.current = { lastBytes: 0, lastTime: Date.now() };

    try {
      if (manifest.files.length === 1) {
        // Single file transfer
        await downloadSingleFile(manifest.files[0]);
        toast.success('Téléchargement terminé !');
      } else {
        // Multi-file: parallel download + ZIP
        const zip = new JSZip();
        let globalDownloaded = 0;

        for (const file of manifest.files) {
          const chunks = await downloadChunksParallel(file.urls, (fileDownloaded) => {
            const total = globalDownloaded + fileDownloaded;
            setProgress((total / manifest.totalSize) * 100);
            updateSpeed(total);
          }, manifest.transferId, authToken || undefined);

          const fileBlob = new Blob(chunks.map(buf => new Uint8Array(buf)));
          zip.file(file.name, fileBlob);

          // Update global offset for next file
          globalDownloaded += chunks.reduce((sum, buf) => sum + buf.byteLength, 0);
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(zipBlob, `Distransfer_${manifest.files.length}_fichiers.zip`);
        toast.success('Téléchargement terminé !');
      }
    } catch (e: unknown) {
      const err = e as Error;
      if (err.name !== 'AbortError') {
        toast.error(`Erreur: ${err.message}`);
      }
    } finally {
      setIsDownloading(false);
      setProgress(0);
      setSpeed(0);
    }
  };

  const handleDownloadSingle = async (file: { name: string; size: number; urls: string[] }) => {
    try {
      toast.info(`Téléchargement de ${file.name}...`);
      setIsDownloading(true);
      setProgress(0);
      setSpeed(0);
      speedRef.current = { lastBytes: 0, lastTime: Date.now() };
      await downloadSingleFile(file);
      toast.success(`${file.name} téléchargé !`);
    } catch (e: unknown) {
      const err = e as Error;
      toast.error(`Erreur: ${err.message}`);
    } finally {
      setIsDownloading(false);
      setProgress(0);
      setSpeed(0);
    }
  };

  // Format speed for display
  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '';
    if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${bytesPerSec.toFixed(0)} B/s`;
  };

  const handleUnlock = async () => {
    if (!manifest?.transferId) return;
    
    setVerifyError(false);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://distransfer-api.distockapp.workers.dev'}/transfer/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferId: manifest.transferId, password })
      });
      
      if (res.ok) {
        const data = await res.json();
        setAuthToken(data.token);
        sessionStorage.setItem('distransfer_jwt', data.token);
        setIsLocked(false);
      } else {
        setVerifyError(true);
        setTimeout(() => setVerifyError(false), 500); // Reset animation state
      }
    } catch (e) {
      toast.error('Erreur réseau lors de la vérification');
    }
  };

  // ─── Loading state ──────────────
  if (loading) {
    return (
      <div className="download-container">
        <div className="loader" />
      </div>
    );
  }

  // ─── Error state ────────────────
  if (error) {
    return (
      <div className="download-container">
        <div className="error-card">
          <div className="error-icon">
            <AlertTriangle size={36} />
          </div>
          <h2 className="error-title">Lien invalide</h2>
          <p className="error-message">{error}</p>
          <a href={`${window.location.pathname}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Retour à l'accueil
          </a>
        </div>
      </div>
    );
  }

  if (!manifest) return null;

  if (isLocked) {
    return (
      <div className="download-container">
        <div className="download-card" style={{ maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
          <div className="download-icon" style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 48 }}>🔒</span>
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>Transfert protégé</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>
            Veuillez saisir le mot de passe pour accéder aux fichiers de ce transfert.
          </p>
          
          <input 
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '8px',
              border: `1px solid ${verifyError ? 'var(--error)' : 'var(--border-color)'}`,
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 16,
              marginBottom: 16,
              transform: verifyError ? 'translateX(0)' : 'none',
              animation: verifyError ? 'shake 0.4s ease-in-out' : 'none'
            }}
          />
          {verifyError && <p style={{ color: 'var(--error)', fontSize: 12, marginTop: -8, marginBottom: 16, textAlign: 'left' }}>Mot de passe incorrect</p>}
          
          <button 
            className="btn btn-primary btn-full btn-lg" 
            onClick={handleUnlock}
            disabled={!password}
          >
            Déverrouiller
          </button>
        </div>
      </div>
    );
  }

  const isSingle = manifest.files.length === 1;
  const file = manifest.files[0];

  return (
    <div className="download-container">
      <div className="download-card">
        <div className="download-icon">
          {isSingle ? (
            <span style={{ fontSize: 40 }}>{getFileIcon(file.name)}</span>
          ) : (
            <span style={{ fontSize: 40 }}>📦</span>
          )}
        </div>

        {isSingle ? (
          <>
            <h1 className="download-filename">{file.name}</h1>
            <p className="download-meta">{formatSize(file.size)}</p>
          </>
        ) : (
          <>
            <h1 className="download-filename">{manifest.files.length} fichiers</h1>
            <p className="download-meta">{formatSize(manifest.totalSize)} au total</p>

            <div className="download-files-list">
              {manifest.files.map((f, i) => (
                <div key={i} className="download-file-row">
                  <span style={{ fontSize: 18 }}>{getFileIcon(f.name)}</span>
                  <span className="download-file-name">{f.name}</span>
                  <span className="download-file-size">{formatSize(f.size)}</span>
                  <button
                    className="file-item-remove"
                    onClick={() => handleDownloadSingle(f)}
                    title="Télécharger ce fichier"
                    style={{ color: 'var(--accent-light)' }}
                    disabled={isDownloading}
                  >
                    <Download size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <button
          className="btn btn-primary btn-full btn-lg"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
              Téléchargement... {progress.toFixed(0)}%
            </>
          ) : (
            <>
              <Download size={20} />
              {isSingle ? 'Télécharger' : `Tout télécharger (ZIP)`}
            </>
          )}
        </button>

        {isDownloading && (
          <div className="progress-section" style={{ marginTop: 16 }}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {speed > 0 && (
              <div className="progress-detail" style={{ marginTop: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Zap size={12} />
                  {formatSpeed(speed)}
                </span>
                <span>Téléchargement parallèle</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper ──────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
