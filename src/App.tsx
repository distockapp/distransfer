import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { HomePage } from './pages/HomePage';
import { DownloadPage } from './pages/DownloadPage';
import { MyTransfersPage } from './pages/MyTransfersPage';
import { ArrowUpFromLine, Clock } from 'lucide-react';

function HeaderNav() {
  const location = useLocation();
  const isTransfers = location.pathname === '/transfers';

  return (
    <header className="header">
      <a href={window.location.pathname} className="header-logo">
        <div className="header-logo-icon">
          <ArrowUpFromLine size={18} />
        </div>
        <div>
          <div className="header-logo-text">Distransfer</div>
        </div>
      </a>

      <div className="header-right">
        <Link
          to="/transfers"
          className={`header-nav-link ${isTransfers ? 'active' : ''}`}
        >
          <Clock size={15} />
          Mes transferts
        </Link>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <>
      <div className="bg-mesh" />
      <HashRouter>
        <HeaderNav />

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/transfers" element={<MyTransfersPage />} />
        </Routes>

        <footer className="footer">
          Propulsé par <a href="https://github.com/distockapp" target="_blank" rel="noopener">Distransfer</a> — Transfert gratuit et illimité
        </footer>
      </HashRouter>
      <Toaster theme="dark" richColors position="bottom-right" />
    </>
  );
}
