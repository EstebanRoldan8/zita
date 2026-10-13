import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, ShoppingBag, X, MessageCircle } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { formatCOP } from '../lib/format';
import { COPY } from '../lib/copy';
import Logo from './Logo';
import BagDrawer from './BagDrawer';

const NAV = [
  { label: 'Inicio', path: '/' },
  { label: 'Tienda', path: '/coleccion' },
  { label: 'Nosotros', path: '/nosotros' },
];

export default function StoreLayout() {
  const { store } = useStore();
  const path = useStorePath();
  const { count, setOpen } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Al cambiar de página se vuelve arriba; el menú móvil se cierra al tocar un enlace
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  const closeMenu = () => setMenuOpen(false);

  const freeFrom = Number(store.free_shipping_from) || 0;
  const whatsapp = store.whatsapp_number ? `https://wa.me/${store.whatsapp_number}` : null;
  const navCls = ({ isActive }) => `flow-label py-2 ${isActive ? 'border-b border-flow-black' : 'border-b border-transparent hover:border-flow-stone'}`;

  return (
    <div className="flow-store flex min-h-screen flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2">Ir al contenido</a>

      {freeFrom > 0 && (
        <div className="bg-flow-black px-4 py-2 text-center text-flow-white flow-on-dark">
          <p className="flow-label" style={{ fontSize: '0.68rem' }}>Envío gratis desde {formatCOP(freeFrom)}</p>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b border-flow-stone bg-flow-white">
        <div className="mx-auto grid max-w-7xl grid-cols-3 items-center px-4 md:px-8">
          <div className="flex items-center">
            <button type="button" className="-ml-2 flex h-11 w-11 items-center justify-center md:hidden"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
            </button>
            <nav className="hidden items-center gap-8 md:flex" aria-label="Principal">
              {NAV.map((n) => <NavLink key={n.path} to={path(n.path)} end={n.path === '/'} className={navCls}>{n.label}</NavLink>)}
            </nav>
          </div>
          <Link to={path('/')} onClick={closeMenu} className="justify-self-center" aria-label={`${store.name || 'Flow'} — inicio`}>
            <Logo height={36} />
          </Link>
          <div className="flex justify-end">
            <button type="button" onClick={() => { closeMenu(); setOpen(true); }} className="-mr-2 relative flex h-11 w-11 items-center justify-center"
              aria-label={`${COPY.bag}: ${count} ${count === 1 ? 'producto' : 'productos'}`}>
              <ShoppingBag size={20} strokeWidth={1.5} />
              {count > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center bg-flow-black px-1 text-[10px] font-semibold text-flow-white">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-flow-stone px-4 pb-4 md:hidden" aria-label="Principal móvil">
            {NAV.map((n) => (
              <NavLink key={n.path} to={path(n.path)} end={n.path === '/'} onClick={closeMenu}
                className="flow-label block border-b border-[color:var(--flow-sand)] py-4">{n.label}</NavLink>
            ))}
          </nav>
        )}
      </header>

      <main id="contenido" className="flex-1">
        <Outlet />
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
