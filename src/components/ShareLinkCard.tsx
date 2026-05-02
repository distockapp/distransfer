import { useState } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { formatSize } from '../lib/utils';

interface Props {
  link: string;
  files: { name: string; size: number }[];
  transferId: string;
  adminToken?: string;
  onNewTransfer: () => void;
}

export function ShareLinkCard({ link, files, transferId, adminToken, onNewTransfer }: Props) {
  const [copied, setCopied] = useState(false);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="share-card">
      <div className="share-success-icon">
        <Check size={36} strokeWidth={3} />
      </div>

      <h2 className="share-title">Transfert terminé !</h2>
      <p className="share-subtitle">
        {files.length} fichier{files.length > 1 ? 's' : ''} • {formatSize(totalSize)}
      </p>

      <div className="share-link-box">
        <span className="share-link-text">{link}</span>
        <button
          className={`btn-copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? (
            <><Check size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Copié !</>
          ) : (
            <><Copy size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Copier</>
          )}
        </button>
      </div>

      <p className="share-info">
        Partagez ce lien avec n'importe qui. Aucune inscription nécessaire pour télécharger.
      </p>

      {adminToken && (
        <div style={{ marginTop: 16, padding: 12, background: 'rgba(255, 255, 255, 0.05)', borderRadius: 8, fontSize: 13, textAlign: 'left' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 8, fontWeight: 500 }}>📊 Lien de suivi administrateur (secret) :</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input 
              type="text" 
              readOnly 
              value={`${window.location.protocol}//${window.location.host}${window.location.pathname}#/stats?transferId=${transferId}&token=${adminToken}`}
              style={{ flex: 1, padding: 8, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)', fontSize: 12 }}
            />
            <button 
              className="btn btn-secondary" 
              style={{ padding: '4px 8px' }}
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.protocol}//${window.location.host}${window.location.pathname}#/stats?transferId=${transferId}&token=${adminToken}`);
              }}
            >
              Copier
            </button>
          </div>
        </div>
      )}

      <button
        className="btn btn-secondary btn-full share-new-btn"
        onClick={onNewTransfer}
      >
        <Plus size={16} />
        Nouveau transfert
      </button>
    </div>
  );
}
