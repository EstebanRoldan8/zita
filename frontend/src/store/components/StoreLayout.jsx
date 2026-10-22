import { useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useStore } from '../hooks/useStore';
import BagDrawer from './BagDrawer';
import AnnouncementBar from './AnnouncementBar';
import StoreHeader from './StoreHeader';
import StoreFooter from './StoreFooter';
import WhatsAppFab from './WhatsAppFab';
import StoreErrorBoundary from './StoreErrorBoundary';

export default function StoreLayout() {
  const { slug } = useStore();
  const location = useLocation();

  const rootRef = useRef(null);

  // Al cambiar de página se vuelve arriba
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  // Alto real del header y de la barra de anuncios como variables CSS (--flow-header-h, --flow-announce-h):
  // el hero sube exactamente bajo el header en cualquier ancho (sin números fijos por breakpoint).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const header = root.querySelector('header');
    const bar = root.querySelector('[data-flow-announce]');
    const sync = () => {
      root.style.setProperty('--flow-header-h', `${header ? header.offsetHeight : 0}px`);
      root.style.setProperty('--flow-announce-h', `${bar ? bar.offsetHeight : 0}px`);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(sync);
    if (header) ro.observe(header);
    if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="flow-store flex min-h-screen flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2">Ir al contenido</a>

      <AnnouncementBar />
      <StoreHeader />

      <main id="contenido" className="flex-1">
        {/* key: al cambiar de página se reintenta el contenido */}
        <StoreErrorBoundary key={location.pathname} slug={slug}>
          <Outlet />
        </StoreErrorBoundary>
      </main>

      <StoreFooter />
      <WhatsAppFab />

      <BagDrawer />
    </div>
  );
}
