import { useEffect } from 'react';
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

  // Al cambiar de página se vuelve arriba
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <div className="flow-store flex min-h-screen flex-col">
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
