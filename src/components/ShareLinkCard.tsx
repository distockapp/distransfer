import { useState } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import { formatSize } from '../lib/utils';

interface Props {
  link: string;
  files: { name: string; size: number }[];
  onNewTransfer: () => void;
}

export function ShareLinkCard({ link, files, onNewTransfer }: Props) {
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
