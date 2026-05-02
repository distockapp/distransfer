import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { BarChart3, AlertTriangle, Globe } from 'lucide-react';
import { toast } from 'sonner';

interface DownloadLog {
  downloader_ip: string;
  country_code: string;
  downloaded_at: string;
}

export function StatsPage() {
  const location = useLocation();
  const [logs, setLogs] = useState<DownloadLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const params = new URLSearchParams(location.search);
        const transferId = params.get('transferId');
        const token = params.get('token');

        if (!transferId || !token) {
          setError("Lien de statistiques invalide. Il manque l'identifiant ou le token.");
          setLoading(false);
          return;
        }

        const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://distransfer-api.distockapp.workers.dev'}/transfer/logs?transferId=${transferId}&token=${token}`);
        
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        } else if (res.status === 401) {
          setError("Lien expiré ou non autorisé.");
        } else {
          setError("Impossible de récupérer les statistiques.");
        }
      } catch (err) {
        console.error('[Distransfer] Error fetching stats:', err);
        setError("Erreur réseau. Veuillez réessayer.");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [location]);

  // Helper to get country flag emoji
  const getFlagEmoji = (countryCode: string) => {
    if (!countryCode || countryCode === 'unknown') return '🌍';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char =>  127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  // Helper to anonymize IP
  const anonymizeIP = (ip: string) => {
    if (!ip || ip === 'unknown') return 'Inconnue';
    // Match IPv4
    if (ip.includes('.')) {
      const parts = ip.split('.');
      if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
    }
    // Match IPv6
    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length >= 4) return `${parts[0]}:${parts[1]}:x:x`;
    }
    return 'IP Masquée';
  };

  if (loading) {
    return (
      <div className="download-container">
        <div className="loader" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="download-container">
        <div className="error-card">
          <div className="error-icon">
            <AlertTriangle size={36} />
          </div>
          <h2 className="error-title">Erreur d'accès</h2>
          <p className="error-message">{error}</p>
          <a href={`${window.location.pathname}`} className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Retour à l'accueil
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-container" style={{ maxWidth: 800 }}>
      <div className="share-card" style={{ padding: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <BarChart3 size={32} color="var(--accent-light)" />
          <h1 style={{ fontSize: 24, fontWeight: 'bold' }}>Statistiques du transfert</h1>
        </div>
        
        <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
          Retrouvez ici l'historique complet des téléchargements pour ce transfert.
        </p>

        {logs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, background: 'var(--bg-secondary)', borderRadius: 12 }}>
            <Globe size={48} color="var(--text-muted)" style={{ margin: '0 auto', marginBottom: 16, opacity: 0.5 }} />
            <h3 style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>Aucun téléchargement</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Personne n'a encore téléchargé ces fichiers.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: 13 }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Pays</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Adresse IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 14 }}>
                    <td style={{ padding: '16px', color: 'var(--text-primary)' }}>
                      {new Date(log.downloaded_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-primary)' }}>
                      <span style={{ fontSize: 18, marginRight: 8 }}>{getFlagEmoji(log.country_code)}</span>
                      {log.country_code || 'Inconnu'}
                    </td>
                    <td style={{ padding: '16px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {anonymizeIP(log.downloader_ip)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
