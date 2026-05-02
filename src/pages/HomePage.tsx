import { useState } from 'react';
import { UploadZone } from '../components/UploadZone';
import { ShareLinkCard } from '../components/ShareLinkCard';

type PageState =
  | { phase: 'upload' }
  | { phase: 'done'; link: string; files: { name: string; size: number }[] };

export function HomePage() {
  const [state, setState] = useState<PageState>({ phase: 'upload' });

  return (
    <div className="upload-container">
      {state.phase === 'upload' ? (
        <>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <h1 style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: -1,
              marginBottom: 8,
              background: 'linear-gradient(135deg, #f0f0f5 0%, #a29bfe 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Envoyez vos fichiers
            </h1>
            <p style={{
              fontSize: 16,
              color: 'var(--text-secondary)',
              maxWidth: 400,
              margin: '0 auto',
              lineHeight: 1.5,
            }}>
              Simple, rapide et gratuit. Obtenez un lien de partage instantané.
            </p>
          </div>
          <UploadZone
            onShareLinkGenerated={(link, files) =>
              setState({ phase: 'done', link, files })
            }
          />
        </>
      ) : (
        <ShareLinkCard
          link={state.link}
          files={state.files}
          onNewTransfer={() => setState({ phase: 'upload' })}
        />
      )}
    </div>
  );
}
