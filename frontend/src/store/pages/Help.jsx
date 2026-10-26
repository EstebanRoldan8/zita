import { ChevronDown, ChevronRight, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo, useSeoContext } from '../hooks/useSeo';
import { helpSeo } from '../lib/seo';
import { flowContent } from '../content/flowContent';
import { faqItems, sizeGuide, policyLinks } from '../lib/policies';
import { waLink } from '../lib/format';
import { whatsappNumber, instagramUrl } from '../lib/contact';

function Accordion({ id, title, children, open = false }) {
  return (
    <details id={id} className="border-b border-flow-stone" open={open}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-base">
        <span className="font-medium">{title}</span>
        <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" />
      </summary>
      <div className="pb-6 text-sm leading-relaxed">{children}</div>
    </details>
  );
}

// /ayuda: FAQ corta de flowContent, enlaces a las políticas legales (y guía de tallas) y contacto
export default function Help() {
  const { store } = useStore();
  const path = useStorePath();
  useSeo(helpSeo(useSeoContext(), { store }));
  const faq = faqItems();
  const guide = sizeGuide();
  const wa = waLink(whatsappNumber(store), 'Hola FLOW, necesito ayuda con mi pedido.');
  const ig = instagramUrl(store);
  const { email, city, whatsappDisplay } = flowContent.brand;
  const hasContact = !!(wa || ig || email || city);
  const links = [...policyLinks(), guide && { label: guide.title, href: '/guia-de-tallas' }].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <h1 className="flow-display text-3xl md:text-4xl">Ayuda</h1>
      <div className="mt-10">
          {faq.length > 0 && (
            <section aria-labelledby="flow-faq" className="mb-12">
              <h2 id="flow-faq" className="flow-label mb-2">Preguntas frecuentes</h2>
              {faq.map((f, i) => <Accordion key={i} title={f.q}><p className="whitespace-pre-line">{f.a}</p></Accordion>)}
              <Link to={path('/preguntas-frecuentes')} className="mt-4 inline-block text-sm underline underline-offset-2">Ver todas las preguntas frecuentes</Link>
            </section>
          )}
          <section aria-labelledby="flow-politicas" className="mb-12">
            <h2 id="flow-politicas" className="flow-label mb-2">Pedidos y políticas</h2>
            {links.map((l) => (
              <Link key={l.href} to={path(l.href)}
                className="flex min-h-14 items-center justify-between gap-4 border-b border-flow-stone py-4 text-base">
                <span className="font-medium">{l.label}</span>
                <ChevronRight size={18} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            ))}
          </section>
          {hasContact && (
            <section aria-labelledby="flow-contacto" className="bg-flow-sand p-6 md:p-8">
              <h2 id="flow-contacto" className="flow-serif text-2xl">Contacto</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {city && <li>{city}</li>}
                {wa && whatsappDisplay && <li>WhatsApp {whatsappDisplay}</li>}
                {email && <li><a href={`mailto:${email}`} className="underline [overflow-wrap:anywhere]">{email}</a></li>}
                {ig && <li><a href={ig} target="_blank" rel="noopener noreferrer" className="underline">Instagram</a></li>}
              </ul>
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-primary mt-6">
                  <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" /> Escríbenos por WhatsApp
                </a>
              )}
            </section>
          )}
      </div>
    </div>
  );
}
