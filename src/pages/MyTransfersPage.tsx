import { useState, useCallback } from 'react';
import { Clock, Trash2, Copy, Check, ExternalLink, FileIcon, AlertTriangle, Inbox } from 'lucide-react';
import { formatSize, getFileIcon } from '../lib/utils';
import {
  getTransferHistory,
  deleteTransferRecord,
  clearTransferHistory,
  type TransferRecord,
} from '../lib/transfer-history';
import { toast } from 'sonner';

export function MyTransfersPage() {
  const [records, setRecords] = useState<TransferRecord[]>(() => getTransferHistory());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const refresh = useCallback(() => {
    setRecords(getTransferHistory());
  }, []);

  const handleCopy = async (link: string, id: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = link;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedId(id);
    toast.success('Lien copié !');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (id: string) => {
    if (deletingId === id) {
      // Second click = confirm
      deleteTransferRecord(id);
      refresh();
      setDeletingId(null);
      toast.success('Transfert supprimé');
    } else {
      // First click = show confirmation state
      setDeletingId(id);
      setTimeout(() => setDeletingId(null), 3000);
    }
  };

  const handleClearAll = () => {
    if (showClearConfirm) {
      clearTransferHistory();
      refresh();
      setShowClearConfirm(false);
      toast.success('Historique effacé');
    } else {
      setShowClearConfirm(true);
      setTimeout(() => setShowClearConfirm(false), 4000);
    }
  };

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffH < 24) return `Il y a ${diffH}h`;
    if (diffD < 7) return `Il y a ${diffD}j`;

    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // ─── Empty state ──────────────────
  if (records.length === 0) {
    return (
      <div className="transfers-container">
        <div className="transfers-empty-card">
          <div className="transfers-empty-icon">
            <Inbox size={40} />
          </div>
          <h2 className="transfers-empty-title">Aucun transfert</h2>
          <p className="transfers-empty-text">
            Vos transferts apparaîtront ici une fois que vous aurez partagé des fichiers.
          </p>
          <a href={window.location.pathname} className="btn btn-primary" style={{ textDecoration: 'none', marginTop: 8 }}>
            Envoyer des fichiers
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="transfers-container">
      {/* Header */}
      <div className="transfers-header">
        <div>
          <h1 className="transfers-title">
            <Clock size={24} />
            Mes transferts
          </h1>
          <p className="transfers-subtitle">
            {records.length} transfert{records.length > 1 ? 's' : ''} effectué{records.length > 1 ? 's' : ''}
          </p>
        </div>

        <button
          className={`btn-clear-all ${showClearConfirm ? 'confirm' : ''}`}
          onClick={handleClearAll}
        >
          <Trash2 size={14} />
          {showClearConfirm ? 'Confirmer la suppression' : 'Tout supprimer'}
        </button>
      </div>

      {/* Transfer list */}
      <div className="transfers-list">
        {records.map((record, idx) => (
          <div
            key={record.id}
            className="transfer-card"
            style={{ animationDelay: `${idx * 50}ms` }}
          >
            {/* Card top: Date & delete */}
            <div className="transfer-card-top">
              <span className="transfer-date">
                <Clock size={12} />
                {formatDate(record.createdAt)}
              </span>
              <button
                className={`transfer-delete ${deletingId === record.id ? 'confirm' : ''}`}
                onClick={() => handleDelete(record.id)}
                title={deletingId === record.id ? 'Cliquez pour confirmer' : 'Supprimer'}
              >
                {deletingId === record.id ? (
                  <>
                    <AlertTriangle size={13} />
                    Confirmer
                  </>
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>

            {/* Files summary */}
            <div className="transfer-files-summary">
              {record.files.slice(0, 3).map((f, fi) => (
                <div key={fi} className="transfer-file-chip">
                  <span className="transfer-file-chip-icon">{getFileIcon(f.name)}</span>
                  <span className="transfer-file-chip-name">{f.name}</span>
                  <span className="transfer-file-chip-size">{formatSize(f.size)}</span>
                </div>
              ))}
              {record.files.length > 3 && (
                <div className="transfer-file-chip transfer-file-chip-more">
                  +{record.files.length - 3} autre{record.files.length - 3 > 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Total size */}
            <div className="transfer-total">
              {record.files.length} fichier{record.files.length > 1 ? 's' : ''} • {formatSize(record.totalSize)}
            </div>

            {/* Link actions */}
            <div className="transfer-actions">
              <button
                className={`transfer-action-btn transfer-copy-btn ${copiedId === record.id ? 'copied' : ''}`}
                onClick={() => handleCopy(record.link, record.id)}
              >
                {copiedId === record.id ? (
                  <>
                    <Check size={14} />
                    Copié !
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copier le lien
                  </>
                )}
              </button>
              <a
                href={record.link}
                target="_blank"
                rel="noopener noreferrer"
                className="transfer-action-btn transfer-open-btn"
              >
                <ExternalLink size={14} />
                Ouvrir
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
