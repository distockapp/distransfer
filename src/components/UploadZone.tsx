import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Plus, X, ArrowRight, FileIcon, Loader2, Zap } from 'lucide-react';
import { formatSize, getFileIcon } from '../lib/utils';
import { uploadFile, type ProgressCallback } from '../lib/discord-storage';
import { generateShareLink, type TransferFile } from '../lib/link-encoder';
import { addTransferRecord } from '../lib/transfer-history';
import { toast } from 'sonner';

interface Props {
  onShareLinkGenerated: (link: string, files: { name: string; size: number }[], transferId: string, adminToken?: string) => void;
}

type Phase = 'idle' | 'uploading' | 'generating';

export function UploadZone({ onShareLinkGenerated }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [speed, setSpeed] = useState(0); // bytes per second
  const [eta, setEta] = useState(''); // estimated time remaining
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef({ lastBytes: 0, lastTime: Date.now() });

  const [isProtected, setIsProtected] = useState(false);
  const [password, setPassword] = useState('');

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles(prev => [...prev, ...arr]);
  }, []);

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Speed & ETA calculation
  const updateSpeed = useCallback((uploaded: number, total: number) => {
    const now = Date.now();
    const elapsed = (now - speedRef.current.lastTime) / 1000;
    if (elapsed >= 0.5) { // Update every 500ms
      const byteDiff = uploaded - speedRef.current.lastBytes;
      const currentSpeed = byteDiff / elapsed;
      setSpeed(currentSpeed);

      // Calculate ETA
      if (currentSpeed > 0) {
        const remaining = total - uploaded;
        const secondsLeft = remaining / currentSpeed;
        if (secondsLeft < 60) {
          setEta(`~${Math.ceil(secondsLeft)}s restant`);
        } else if (secondsLeft < 3600) {
          setEta(`~${Math.ceil(secondsLeft / 60)}min restant`);
        } else {
          setEta(`~${(secondsLeft / 3600).toFixed(1)}h restant`);
        }
      }

      speedRef.current = { lastBytes: uploaded, lastTime: now };
    }
  }, []);

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '';
    if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${bytesPerSec.toFixed(0)} B/s`;
  };

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleTransfer = async () => {
    if (files.length === 0) return;
    setPhase('uploading');
    setProgress(0);
    setUploadedBytes(0);
    setTotalBytes(totalSize);
    setSpeed(0);
    setEta('');
    speedRef.current = { lastBytes: 0, lastTime: Date.now() };

    try {
      const transferFiles: TransferFile[] = [];
      let globalUploaded = 0;

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        setCurrentFile(file.name);
        const fileStart = globalUploaded;

        // Cooldown between files: let Discord rate limits partially reset.
        // Without this, sustained uploads (>1GB) trigger cascading 503s.
        if (fi > 0) {
          console.log(`[Distransfer] ⏳ Cooldown 3s before file ${fi + 1}/${files.length}...`);
          await new Promise(r => setTimeout(r, 3000));
        }

        const onProgress: ProgressCallback = (uploaded, total) => {
          const fileProgress = uploaded / total;
          const globalProgress = (fileStart + file.size * fileProgress) / totalSize;
          const globalBytes = fileStart + uploaded;
          setProgress(globalProgress * 100);
          setUploadedBytes(globalBytes);
          updateSpeed(globalBytes, totalSize);
        };

        const result = await uploadFile(file, onProgress);
        transferFiles.push({
          name: file.name,
          size: file.size,
          urls: result.urls,
        });

        globalUploaded += file.size;
      }

      setPhase('generating');
      setCurrentFile('Génération du lien...');

      const transferId = crypto.randomUUID();
      const link = await generateShareLink(transferFiles, transferId);

      // Create transfer in database
      setCurrentFile('Sécurisation du transfert...');
      let adminToken: string | undefined;
      try {
        const createRes = await fetch(`${import.meta.env.VITE_API_URL || 'https://distransfer-api.distockapp.workers.dev'}/transfer/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transferId, password: isProtected && password ? password : null })
        });
        
        if (createRes.ok) {
          const createData = await createRes.json();
          adminToken = createData.adminToken;
        } else {
          console.error('[Distransfer] API /transfer/create error:', await createRes.text());
          toast.error('Erreur lors de la sécurisation du transfert. Le lien fonctionnera mais sans mot de passe.');
        }
      } catch (err) {
        console.error('[Distransfer] API call failed:', err);
        toast.error('Erreur réseau lors de la sécurisation. Le lien fonctionnera mais sans mot de passe.');
      }

      // Save to local transfer history
      const filesMeta = files.map(f => ({ name: f.name, size: f.size }));
      addTransferRecord(filesMeta, link);

      onShareLinkGenerated(link, filesMeta, transferId, adminToken);
      toast.success('Transfert terminé !');
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[Distransfer] Upload failed:', error);
      toast.error(`Erreur: ${error.message}`);
      setPhase('idle');
    }
  };

  // Paste support
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      if (e.clipboardData?.files.length) {
        handleFiles(e.clipboardData.files);
      }
    };
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [handleFiles]);

  const isUploading = phase !== 'idle';

  return (
    <div className="upload-card">
      {/* Drop zone */}
      <div
        ref={dropRef}
        className={`dropzone ${isDragging ? 'active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        style={{ pointerEvents: isUploading ? 'none' : 'auto' }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
        <div className="dropzone-icon">
          <Upload size={28} />
        </div>
        <div className="dropzone-title">
          {isDragging ? 'Déposez vos fichiers ici' : 'Ajoutez vos fichiers'}
        </div>
        <div className="dropzone-subtitle">
          Glissez-déposez ou cliquez pour parcourir
        </div>
        <div className="dropzone-hint">
          Aucune limite de taille • Tous types de fichiers
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="file-item">
              <div className="file-item-icon">
                <span style={{ fontSize: 20 }}>{getFileIcon(file.name)}</span>
              </div>
              <div className="file-item-info">
                <div className="file-item-name">{file.name}</div>
                <div className="file-item-size">{formatSize(file.size)}</div>
              </div>
              {!isUploading && (
                <button className="file-item-remove" onClick={() => removeFile(i)} title="Retirer">
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Progress */}
      {isUploading && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">
              {phase === 'generating' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  Génération du lien...
                </span>
              ) : (
                `Envoi de ${currentFile}`
              )}
            </span>
            <span className="progress-value">{progress.toFixed(0)}%</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-detail">
            <span>{formatSize(uploadedBytes)} / {formatSize(totalBytes)}</span>
            <span>{files.length} fichier(s)</span>
          </div>
          {/* Speed & ETA row */}
          {phase === 'uploading' && speed > 0 && (
            <div className="progress-detail" style={{ marginTop: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-light)' }}>
                <Zap size={12} />
                {formatSpeed(speed)}
              </span>
              {eta && (
                <span style={{ color: 'var(--text-muted)' }}>{eta}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add more button */}
      {files.length > 0 && !isUploading && (
        <button
          className="btn btn-secondary btn-full"
          onClick={() => fileInputRef.current?.click()}
          style={{ marginTop: 8 }}
        >
          <Plus size={16} />
          Ajouter des fichiers
        </button>
      )}

      {/* Password Protection */}
      {files.length > 0 && !isUploading && (
        <div style={{ marginTop: 16, padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={isProtected} 
              onChange={e => setIsProtected(e.target.checked)} 
            />
            <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Protéger par mot de passe</span>
          </label>
          {isProtected && (
            <input
              type="password"
              placeholder="Saisissez un mot de passe"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                marginTop: '12px',
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)'
              }}
            />
          )}
        </div>
      )}

      {/* Transfer button */}
      {files.length > 0 && !isUploading && (
        <button
          className="btn btn-primary btn-full btn-lg"
          onClick={handleTransfer}
          style={{ marginTop: 24 }}
          disabled={isProtected && password.length < 3}
        >
          <ArrowRight size={20} />
          Transférer {files.length} fichier{files.length > 1 ? 's' : ''} ({formatSize(totalSize)})
        </button>
      )}
    </div>
  );
}
