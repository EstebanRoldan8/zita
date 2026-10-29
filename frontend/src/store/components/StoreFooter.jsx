import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useStore, useStorePath } from '../hooks/useStore';
import { useStoreNav } from '../hooks/useStoreNav';
import { flowContent } from '../content/flowContent';
import { sizeGuide, policyLinks } from '../lib/policies';
import { waLink } from '../lib/format';
import { whatsappNumber, instagramUrl } from '../lib/contact';
import Logo from './Logo';
import PqrBlock from './PqrBlock';

// Enlace interno o externo; los nulos ya vienen filtrados
function FooterLink({ link }) {
  const cls = 'inline-flex min-h-9 items-center hover:underline';
  if (link.external) return <a href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>{link.label}</a>;
  // El correo va en una sola línea (sin partirlo en la @); overflow-wrap solo como último recurso
  if (link.mailto) {
    return <a href={link.href} className={`${cls} text-[0.8125rem] [overflow-wrap:anywhere]`}>{link.label}</a>;
  }
  if (!link.href) return <span className="inline-flex min-h-9 items-center text-flow-sand">{link.label}</span>;
  return <Link to={link.href} className={cls}>{link.label}</Link>;
}

// Footer: logo blanco grande, columnas (acordeones en móvil), pagos, legal. Flow Club vive en la banda de la portada.
// Cada enlace se oculta si su destino es null. Las políticas legales y la sección PQR siempre están.
export default function StoreFooter() {
  const { store } = useStore();
  const path = useStorePath();
  const nav = useStoreNav();
  const collection = nav.collection;

  const wa = waLink(whatsappNumber(store), 'Hola FLOW, tengo una pregunta.');
  const clubChannel = flowContent.club?.channelUrl || null;
  const ig = instagramUrl(store);
  const tiktok = store?.social?.tiktok || null;
  const { email, city, whatsappDisplay } = flowContent.brand;
  const hasContact = !!(wa || ig || email || city);
  const payments = typeof store?.payment_methods === 'string' && store.payment_methods.trim() ? store.payment_methods.trim() : null;

  const columns = [
    {
      title: 'Comprar',
      links: [
        ...nav.sections.map((sec) => ({ label: sec.label, href: sec.href })),
        nav.items.some((i) => i.id === 'todo') && { label: 'Ver todo', href: path('/coleccion') },
        nav.drops.length > 0 && { label: 'Colores', href: path('/colores') },
        nav.archiveCategory && { label: 'Archive', href: nav.archiveCategory.href },
      ],
    },
    {
      title: 'Ayuda',
      links: [
        // Términos, Privacidad, Cambios y devoluciones, Envíos y pagos, Preguntas frecuentes, Formatos, PQR
        ...policyLinks().map((l) => ({ label: l.label, href: path(l.href) })),
        sizeGuide() && { label: sizeGuide().title, href: path('/guia-de-tallas') },
        hasContact && { label: 'Contacto', href: path('/ayuda') },
      ],
    },
    {
      title: 'FLOW',
      links: [
        nav.items.some((i) => i.id === 'sobre') && { label: 'Sobre FLOW', href: path('/sobre-flow') },
        collection && { label: collection.name, href: path(`/coleccion/${collection.slug}`) },
        clubChannel && { label: flowContent.club.title, href: clubChannel, external: true },
      ],
    },
    {
      title: 'Contacto',
      links: [
        wa && { label: whatsappDisplay ? `WhatsApp ${whatsappDisplay}` : 'WhatsApp', href: wa, external: true },
        ig && { label: 'Instagram', href: ig, external: true },
        tiktok && { label: 'TikTok', href: tiktok, external: true },
        email && { label: email, href: `mailto:${email}`, mailto: true },
        city && { label: city },
      ],
    },
  ].map((c) => ({ ...c, links: c.links.filter(Boolean) })).filter((c) => c.links.length > 0);

  const legal = [
    { label: 'Términos', href: path('/terminos') },
    { label: 'Privacidad', href: path('/privacidad') },
    { label: 'Cambios', href: path('/cambios') },
    { label: 'Promociones', href: path('/promociones') },
  ];

  return (
    <footer className="bg-flow-black text-flow-white flow-on-dark">
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-14 md:px-8 md:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Logo height={56} variant="blanco" safeArea={false} />
            <p className="flow-script mt-4 text-4xl text-flow-sand">{flowContent.brand.slogan}</p>
          </div>

          {/* Desktop: columnas */}
          <div className="hidden gap-8 text-sm md:grid md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
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

        <PqrBlock onDark className="mt-10 border-t border-[color:var(--flow-stone)] pt-8" />

        {payments && (
          <p className="mt-8 text-xs text-flow-sand"><span className="flow-label text-flow-stone">Medios de pago</span> · {payments}</p>
        )}

        <div className="mt-8 flex flex-col gap-4 text-xs text-flow-stone md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {flowContent.brand.name}</p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {legal.map((l) => <li key={l.label}><Link to={l.href} className="inline-flex min-h-9 items-center hover:underline">{l.label}</Link></li>)}
          </ul>
          <p className="opacity-70">Tienda hecha con ZITA</p>
        </div>
      </div>
    </footer>
  );
}
