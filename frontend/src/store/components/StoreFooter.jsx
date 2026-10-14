import { Link } from 'react-router-dom';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useStoreNav } from '../hooks/useStoreNav';
import { flowContent } from '../content/flowContent';
import { policyText, faqItems, sizeGuide } from '../lib/policies';
import { waLink } from '../lib/format';
import Logo from './Logo';

// Enlace interno o externo; los nulos ya vienen filtrados
function FooterLink({ link }) {
  const cls = 'inline-flex min-h-9 items-center hover:underline';
  if (link.external) return <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>{link.label}</a>;
  if (link.mailto) return <a href={link.href} className={cls}>{link.label}</a>;
  if (!link.href) return <span className="inline-flex min-h-9 items-center text-flow-sand">{link.label}</span>;
  return <Link to={link.href} className={cls}>{link.label}</Link>;
}

// Footer: logo blanco grande, columnas (acordeones en móvil), Flow Club, pagos, legal.
// Cada enlace se oculta si su destino es null.
export default function StoreFooter() {
  const { store } = useStore();
  const path = useStorePath();
  const nav = useStoreNav();
  const collection = nav.collection;

  const wa = waLink(store?.whatsapp_number, 'Hola FLOW, tengo una pregunta.');
  const clubWa = waLink(store?.whatsapp_number, flowContent.club?.whatsappMessage);
  const ig = store?.social?.instagram || flowContent.brand.instagram;
  const tiktok = store?.social?.tiktok || null;
  const { email, city } = flowContent.brand;
  const envios = policyText('envios', store);
  const cambios = policyText('cambios', store);
  const privacidad = policyText('privacidad', store);
  const terminos = policyText('terminos', store);
  const hasContact = !!(wa || ig || email || city);
  const payments = typeof store?.payment_methods === 'string' && store.payment_methods.trim() ? store.payment_methods.trim() : null;

  const columns = [
    {
      title: 'Comprar',
      links: [
        nav.items.some((i) => i.id === 'nuevo') && collection && { label: 'Nuevo', href: path(`/coleccion/${collection.slug}`) },
        ...nav.shopCategories.slice(0, 6).map((c) => ({ label: c.name, href: c.href })),
        nav.drops.length > 0 && { label: 'Colores', href: path('/colores') },
        nav.archiveCategory && { label: 'Archive', href: nav.archiveCategory.href },
      ],
    },
    {
      title: 'Ayuda',
      links: [
        envios && { label: 'Envíos', href: path('/envios') },
        cambios && { label: 'Cambios y devoluciones', href: path('/cambios') },
        hasContact && { label: 'Contacto', href: path('/ayuda') },
        faqItems().length > 0 && { label: 'Preguntas frecuentes', href: path('/ayuda') },
        sizeGuide() && { label: 'Guía de tallas', href: `${path('/ayuda')}#guia-de-tallas` },
      ],
    },
    {
      title: 'FLOW',
      links: [
        nav.items.some((i) => i.id === 'sobre') && { label: 'Sobre FLOW', href: path('/sobre-flow') },
        collection && { label: collection.name, href: path(`/coleccion/${collection.slug}`) },
        clubWa && { label: flowContent.club.title, href: clubWa, external: true },
      ],
    },
    {
      title: 'Contacto',
      links: [
        wa && { label: 'WhatsApp', href: wa, external: true },
        ig && { label: 'Instagram', href: ig, external: true },
        tiktok && { label: 'TikTok', href: tiktok, external: true },
        email && { label: email, href: `mailto:${email}`, mailto: true },
        city && { label: city },
      ],
    },
  ].map((c) => ({ ...c, links: c.links.filter(Boolean) })).filter((c) => c.links.length > 0);

  const legal = [
    terminos && { label: 'Términos', href: path('/terminos') },
    privacidad && { label: 'Privacidad', href: path('/privacidad') },
    cambios && { label: 'Cambios', href: path('/cambios') },
  ].filter(Boolean);

  return (
    <footer className="bg-flow-black text-flow-white flow-on-dark">
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-14 md:px-8 md:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo height={56} variant="blanco" safeArea={false} />
            <p className="flow-script mt-4 text-4xl text-flow-sand">{flowContent.brand.slogan}</p>
          </div>

          {/* Desktop: columnas */}
          <div className="hidden gap-8 text-sm md:grid md:grid-cols-4">
            {columns.map((c) => (
              <div key={c.title}>
                <p className="flow-label mb-3 text-flow-stone">{c.title}</p>
                <ul>{c.links.map((l) => <li key={l.label}><FooterLink link={l} /></li>)}</ul>
              </div>
            ))}
          </div>

          {/* Móvil: acordeones */}
          <div className="border-t border-[color:var(--flow-stone)] md:hidden">
            {columns.map((c) => (
              <details key={c.title} className="border-b border-[color:var(--flow-stone)]">
                <summary className="flow-label flex min-h-12 cursor-pointer list-none items-center justify-between">
                  {c.title} <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                </summary>
                <ul className="pb-4 text-sm">{c.links.map((l) => <li key={l.label}><FooterLink link={l} /></li>)}</ul>
              </details>
            ))}
          </div>
        </div>

        {(clubWa || ig) && (
          <div className="mt-14 flex flex-col gap-4 border-y border-[color:var(--flow-stone)] py-8 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="flow-collection-name text-2xl">{flowContent.club.title}</p>
              <p className="mt-1 text-sm text-flow-sand">{flowContent.club.text}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              {clubWa && (
                <a href={clubWa} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-light">
                  <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" /> WhatsApp
                </a>
              )}
              {ig && <a href={ig} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-outline flow-btn-outline-light">Instagram</a>}
            </div>
          </div>
        )}

        {payments && (
          <p className="mt-8 text-xs text-flow-sand"><span className="flow-label text-flow-stone">Medios de pago</span> · {payments}</p>
        )}

        <div className="mt-8 flex flex-col gap-4 text-xs text-flow-stone md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {flowContent.brand.name}</p>
          {legal.length > 0 && (
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {legal.map((l) => <li key={l.label}><Link to={l.href} className="inline-flex min-h-9 items-center hover:underline">{l.label}</Link></li>)}
            </ul>
          )}
          <p className="opacity-70">Tienda hecha con ZITA</p>
        </div>
      </div>
    </footer>
  );
}
