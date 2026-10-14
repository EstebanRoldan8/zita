import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, Search, ShoppingBag, X, MessageCircle, ChevronDown } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useStoreNav } from '../hooks/useStoreNav';
import { flowContent } from '../content/flowContent';
import { waLink } from '../lib/format';
import Logo from './Logo';
import ColorDot from './ColorDot';
import SearchOverlay from './SearchOverlay';

function isCurrent(href, location) {
  const [hrefPath, hrefQuery = ''] = String(href).split('?');
  if (location.pathname !== hrefPath && !location.pathname.startsWith(`${hrefPath}/`)) return false;
  if (!hrefQuery) return !location.search || location.pathname !== hrefPath;
  const want = new URLSearchParams(hrefQuery);
  const have = new URLSearchParams(location.search);
  return [...want.entries()].every(([k, v]) => have.get(k) === v);
}

// Header estilo ALO: logo centrado y grande, nav a la izquierda, íconos a la derecha.
// En el inicio es transparente sobre el hero y pasa a sólido al hacer scroll.
export default function StoreHeader() {
  const { store, base } = useStore();
  const path = useStorePath();
  const location = useLocation();
  const { count, setOpen: setBagOpen } = useCart();
  const nav = useStoreNav();
  const [scrolled, setScrolled] = useState(false);
  const [mega, setMega] = useState(null); // id del item con el mega menú abierto
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const headerRef = useRef(null);
  const megaTriggerRef = useRef(null);

  const homePath = base || '/';
  const isHome = location.pathname === homePath || location.pathname === `${homePath}/`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Esc cierra el mega menú y devuelve el foco al item que lo abrió
  useEffect(() => {
    if (!mega) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setMega(null); megaTriggerRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mega]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [mobileOpen]);

  const closeAll = () => { setMega(null); setMobileOpen(false); };
  const transparent = isHome && !scrolled && !mega && !mobileOpen;
  // Hero sin foto = fondo sand claro → texto oscuro; con foto (overlay oscuro) → texto claro
  const heroHasImage = !!nav.collection?.hero?.image;
  const lightText = transparent && heroHasImage;
  const whatsapp = waLink(store?.whatsapp_number, 'Hola FLOW, tengo una pregunta.');
  const megaItem = nav.items.find((i) => i.id === mega);

  const iconBtn = 'relative flex h-11 w-11 items-center justify-center';

  return (
    <>
      <header ref={headerRef} onMouseLeave={() => setMega(null)}
        className={`flow-header sticky top-0 z-40 transition-colors duration-200 ${transparent ? 'bg-transparent' : 'bg-flow-white flow-header-solid'} ${scrolled ? 'is-scrolled' : ''} ${lightText ? 'text-flow-white flow-on-dark' : 'text-flow-black'}`}>
        <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-3 md:px-8">
          {/* Izquierda: hamburguesa (móvil) / navegación (desktop) */}
          <div className="flex items-center">
            <button type="button" className={`${iconBtn} -ml-1 lg:hidden`} aria-label="Abrir menú" aria-expanded={mobileOpen}
              onClick={() => { setMobileOpen(true); setMega(null); }}>
              <Menu size={22} strokeWidth={1.5} />
            </button>
            <nav className="hidden min-w-0 items-center gap-5 lg:flex" aria-label="Principal">
              {nav.items.map((item) => {
                // Activo = misma ruta y mismos parámetros (?categoria=...); NavLink solo compara la ruta
                const active = isCurrent(item.href, location);
                return (
                  <Link key={item.id} to={item.href} onClick={closeAll} aria-current={active ? 'page' : undefined}
                    onMouseEnter={(e) => { if (item.mega) { megaTriggerRef.current = e.currentTarget; setMega(item.id); } else setMega(null); }}
                    onFocus={(e) => { if (item.mega) { megaTriggerRef.current = e.currentTarget; setMega(item.id); } else setMega(null); }}
                    aria-haspopup={item.mega ? 'true' : undefined} aria-expanded={item.mega ? mega === item.id : undefined}
                    className={`flow-label flow-nav-link whitespace-nowrap border-b py-2 ${item.wide ? 'hidden xl:inline-block' : ''} ${active || mega === item.id ? 'border-current' : 'border-transparent hover:border-current'}`}>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Centro: logo grande */}
          <Link to={homePath} onClick={closeAll} className="flow-header-logo flex justify-self-center" aria-label="FLOW, inicio">
            <Logo height={48} variant={lightText ? 'blanco' : 'negro'} safeArea={false} eager fluid />
          </Link>

          {/* Derecha: buscar, WhatsApp, bolsa */}
          <div className="-mr-1 flex items-center justify-end">
            <button type="button" className={iconBtn} aria-label="Buscar" onClick={() => { setSearchOpen(true); closeAll(); }}>
              <Search size={20} strokeWidth={1.5} />
            </button>
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${iconBtn} hidden sm:flex`} aria-label="Escríbenos por WhatsApp">
                <MessageCircle size={20} strokeWidth={1.5} />
              </a>
            )}
            <button type="button" className={iconBtn} onClick={() => { closeAll(); setBagOpen(true); }}
              aria-label={`Bolsa: ${count} ${count === 1 ? 'producto' : 'productos'}`}>
              <ShoppingBag size={20} strokeWidth={1.5} />
              {count > 0 && (
                <span className="absolute right-0.5 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-flow-black px-1 text-[10px] font-semibold text-flow-white"
                  style={lightText ? { backgroundColor: 'var(--flow-white)', color: 'var(--flow-black)' } : undefined}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mega menú (desktop) */}
        {megaItem && (
          <div className="absolute inset-x-0 top-full hidden border-t border-flow-stone bg-flow-white text-flow-black lg:block" role="region" aria-label={`Menú ${megaItem.label}`}>
            <div className="mx-auto grid max-w-7xl grid-cols-[1fr_1fr_1.2fr] gap-10 px-8 py-10">
              <div>
                <p className="flow-label mb-4 text-flow-muted">Categorías</p>
                <ul className="space-y-3 text-sm">
                  {(megaItem.categories || nav.shopCategories).map((c) => (
                    <li key={c.name}><Link to={c.href || `${path('/coleccion')}?categoria=${encodeURIComponent(c.name)}`} onClick={closeAll} className="hover:underline">{c.name}</Link></li>
                  ))}
                  {nav.collection && (
                    <li><Link to={path(`/coleccion/${nav.collection.slug}`)} onClick={closeAll} className="font-medium hover:underline">{nav.collection.label}</Link></li>
                  )}
                  {nav.archiveCategory && (
                    <li><Link to={nav.archiveCategory.href} onClick={closeAll} className="text-flow-muted hover:underline">{flowContent.archive.title}</Link></li>
                  )}
                </ul>
              </div>
              {nav.drops.length > 0 && (
                <div>
                  <p className="flow-label mb-4 text-flow-muted">Comprar por color</p>
                  <ul className="space-y-3 text-sm">
                    {nav.drops.map((d) => (
                      <li key={d.slug}>
                        <Link to={d.href} onClick={closeAll} className="inline-flex items-center gap-3 hover:underline">
                          <ColorDot name={d.colors[0]} hex={d.palette?.bg} size={12} label={false} /> {d.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {nav.featured && (
                <Link to={nav.featured.href} onClick={closeAll} className="group relative block overflow-hidden" style={{ aspectRatio: '16 / 10', background: nav.featured.palette?.bg || 'var(--flow-sand)' }}>
                  {nav.featured.image && (
                    <img src={nav.featured.image} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  )}
                  <span className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(28,28,28,0.65), rgba(28,28,28,0) 60%)' }} aria-hidden="true" />
                  <span className="absolute bottom-5 left-5 text-flow-white">
                    <span className="flow-label block opacity-90">{nav.collection?.eyebrow}</span>
                    <span className="flow-collection-name mt-1 block text-3xl">{nav.featured.title}</span>
                  </span>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Drawer móvil a pantalla completa con acordeones */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[55] flex flex-col overflow-y-auto bg-flow-white text-flow-black lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="flex items-center justify-between border-b border-flow-stone px-3 py-2">
            <button type="button" className={iconBtn} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} autoFocus>
              <X size={22} strokeWidth={1.5} />
            </button>
            <Logo height={30} safeArea={false} />
            <span className="h-11 w-11" aria-hidden="true" />
          </div>
          <nav className="flex-1 px-5 py-4" aria-label="Menú móvil">
            {nav.collection && nav.items.some((i) => i.id === 'nuevo') && (
              <Link to={path(`/coleccion/${nav.collection.slug}`)} onClick={closeAll} className="flow-label block border-b border-[color:var(--flow-sand)] py-4">
                Nuevo · {nav.collection.label}
              </Link>
            )}
            {nav.shopCategories.length > 0 && (
              <details className="border-b border-[color:var(--flow-sand)]" open>
                <summary className="flow-label flex cursor-pointer list-none items-center justify-between py-4">
                  Comprar <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                </summary>
                <ul className="space-y-1 pb-4">
                  {nav.shopCategories.map((c) => (
                    <li key={c.name}><Link to={c.href} onClick={closeAll} className="block py-2 text-sm">{c.name}</Link></li>
                  ))}
                </ul>
              </details>
            )}
            {nav.drops.length > 0 && (
              <details className="border-b border-[color:var(--flow-sand)]">
                <summary className="flow-label flex cursor-pointer list-none items-center justify-between py-4">
                  Comprar por color <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                </summary>
                <ul className="space-y-1 pb-4">
                  {nav.drops.map((d) => (
                    <li key={d.slug}>
                      <Link to={d.href} onClick={closeAll} className="flex items-center gap-3 py-2 text-sm">
                        <ColorDot name={d.colors[0]} hex={d.palette?.bg} size={12} label={false} /> {d.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {nav.items.filter((i) => ['archive', 'sobre'].includes(i.id)).map((i) => (
              <Link key={i.id} to={i.href} onClick={closeAll} className="flow-label block border-b border-[color:var(--flow-sand)] py-4">{i.label}</Link>
            ))}
            <Link to={path('/ayuda')} onClick={closeAll} className="flow-label block border-b border-[color:var(--flow-sand)] py-4">Ayuda</Link>
          </nav>
          {whatsapp && (
            <div className="border-t border-flow-stone px-5 py-5">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-primary w-full">
                <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" /> Escríbenos por WhatsApp
              </a>
            </div>
          )}
        </div>
      )}

      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}
