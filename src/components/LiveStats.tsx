import { useEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════
   LiveStats — Compteur de statistiques en direct
   
   Ce composant affiche deux métriques animées :
   - Nombre total de fichiers transférés
   - Volume total de données transférées (en Go/To)
   
   🔧 CONFIGURATION — Modifie ces valeurs selon tes besoins :
   ═══════════════════════════════════════════════════════════════ */

// ─── Valeurs initiales (à remplacer par les données backend) ──
const INITIAL_FILES = 1_245_890;        // Nombre de fichiers de départ
const INITIAL_BYTES = 48_960_000_000_000; // Volume de départ en octets (~48.96 To)

// ─── Vitesse de l'animation ──────────────────────────────────
const TICK_INTERVAL_MS = 2000;          // Intervalle entre chaque incrément (ms)

// ─── Plage aléatoire d'incrément par tick ────────────────────
const FILES_INCREMENT_MIN = 1;          // Min fichiers ajoutés par tick
const FILES_INCREMENT_MAX = 5;          // Max fichiers ajoutés par tick
const BYTES_INCREMENT_MIN = 5_000_000;  // Min octets ajoutés par tick (~5 Mo)
const BYTES_INCREMENT_MAX = 50_000_000; // Max octets ajoutés par tick (~50 Mo)


/** Retourne un entier aléatoire entre min et max (inclus) */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Formate un nombre avec séparateurs de milliers (espace insécable) */
function formatNumber(n: number): string {
  return n.toLocaleString('fr-FR');
}

/** Convertit des octets en chaîne lisible (Go ou To) */
function formatBytes(bytes: number): string {
  const TO = 1_000_000_000_000; // 1 téraoctet
  const GO = 1_000_000_000;     // 1 gigaoctet

  if (bytes >= TO) {
    const value = bytes / TO;
    // Affiche 1 décimale si < 100 To, sinon entier
    return value < 100
      ? `${value.toFixed(1).replace('.', ',')} To`
      : `${formatNumber(Math.floor(value))} To`;
  }
  return `${formatNumber(Math.floor(bytes / GO))} Go`;
}

export function LiveStats() {
  const [files, setFiles] = useState(INITIAL_FILES);
  const [bytes, setBytes] = useState(INITIAL_BYTES);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFiles(prev => prev + randomBetween(FILES_INCREMENT_MIN, FILES_INCREMENT_MAX));
      setBytes(prev => prev + randomBetween(BYTES_INCREMENT_MIN, BYTES_INCREMENT_MAX));
    }, TICK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <section className="live-stats" aria-label="Statistiques en direct">
      <div className="live-stats-item">
        <div className="live-stats-icon">
          {/* Icône fichiers — SVG inline */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
            <path d="M14 2v4a2 2 0 0 0 2 2h4" />
          </svg>
        </div>
        <div className="live-stats-content">
          <span className="live-stats-value" key={files}>
            {formatNumber(files)}
          </span>
          <span className="live-stats-label">fichiers transférés</span>
        </div>
      </div>

      <div className="live-stats-divider" />

      <div className="live-stats-item">
        <div className="live-stats-icon">
          {/* Icône données — SVG inline */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5V19A9 3 0 0 0 21 19V5" />
            <path d="M3 12A9 3 0 0 0 21 12" />
          </svg>
        </div>
        <div className="live-stats-content">
          <span className="live-stats-value" key={bytes}>
            {formatBytes(bytes)}
          </span>
          <span className="live-stats-label">de données transférées</span>
        </div>
      </div>

      {/* Indicateur "en direct" */}
      <div className="live-stats-pulse">
        <span className="live-stats-dot" />
        <span className="live-stats-live-text">En direct</span>
      </div>
    </section>
  );
}
