import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { COPY } from '../lib/copy';
import Logo from './Logo';
import BagDrawer from './BagDrawer';
import AnnouncementBar from './AnnouncementBar';
import StoreHeader from './StoreHeader';
import StoreErrorBoundary from './StoreErrorBoundary';

export default function StoreLayout() {
  const { store, slug } = useStore();
  const path = useStorePath();
  const location = useLocation();

  // Al cambiar de página se vuelve arriba
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  const whatsapp = store.whatsapp_number ? `https://wa.me/${store.whatsapp_number}` : null;

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

      <footer className="bg-flow-black text-flow-white flow-on-dark">
        <div className="mx-auto max-w-7xl px-4 py-14 md:px-8">
          <div className="flex flex-col items-center text-center">
            <Logo height={40} variant="blanco" />
            <p className="flow-script mt-4 text-3xl text-flow-sand">{COPY.slogan}</p>
          </div>
          <div className="mt-12 grid gap-8 border-t border-[color:var(--flow-stone)] pt-10 text-sm sm:grid-cols-3">
            <div>
              <p className="flow-label text-flow-stone mb-3">Tienda</p>
              <ul className="space-y-2">
                <li><Link to={path('/coleccion')} className="hover:underline">Colección</Link></li>
                <li><Link to={path('/nosotros')} className="hover:underline">Nosotros</Link></li>
              </ul>
            </div>
            <div>
              <p className="flow-label text-flow-stone mb-3">Ayuda</p>
              <ul className="space-y-2">
                <li><Link to={path('/envios')} className="hover:underline">Envíos</Link></li>
                <li><Link to={path('/cambios')} className="hover:underline">Cambios y devoluciones</Link></li>
                <li><Link to={path('/privacidad')} className="hover:underline">Privacidad</Link></li>
              </ul>
            </div>
            <div>
              <p className="flow-label text-flow-stone mb-3">Contacto</p>
              <ul className="space-y-2">
                {whatsapp && (
                  <li><a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:underline">
                    <MessageCircle size={16} strokeWidth={1.5} /> WhatsApp</a></li>
                )}
                {store.social?.instagram && (
                  <li><a href={store.social.instagram} target="_blank" rel="noopener noreferrer" className="hover:underline">Instagram</a></li>
                )}
                {store.social?.tiktok && (
                  <li><a href={store.social.tiktok} target="_blank" rel="noopener noreferrer" className="hover:underline">TikTok</a></li>
                )}
              </ul>
            </div>
          </div>
          <p className="mt-12 text-xs text-flow-stone">© {new Date().getFullYear()} {store.name || 'Flow'}</p>
        </div>
      </footer>

      <BagDrawer />
    </div>
  );
}
