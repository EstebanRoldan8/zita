import { ChevronDown, MessageCircle } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { flowContent } from '../content/flowContent';
import { policyText, faqItems, sizeGuide } from '../lib/policies';
import { waLink } from '../lib/format';
import SizeGuideTable from '../components/SizeGuideTable';

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

// /ayuda: cada bloque se oculta si no tiene contenido (FAQ, envíos, cambios, guía de tallas, contacto)
export default function Help() {
  const { store } = useStore();
  useDocumentMeta(`Ayuda — ${flowContent.brand.name}`, `Preguntas frecuentes, envíos, cambios y contacto de ${flowContent.brand.name}.`);
  const faq = faqItems();
  const envios = policyText('envios', store);
  const cambios = policyText('cambios', store);
  const guide = sizeGuide();
  const wa = waLink(store?.whatsapp_number, 'Hola FLOW, necesito ayuda con mi pedido.');
  const ig = store?.social?.instagram || flowContent.brand.instagram;
  const { email, city } = flowContent.brand;
  const hasContact = !!(wa || ig || email || city);
  const nothing = faq.length === 0 && !envios && !cambios && !guide && !hasContact;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <h1 className="flow-display text-3xl md:text-4xl">Ayuda</h1>
      {nothing ? (
        <p className="mt-8 text-sm text-flow-muted">Esta sección aún no tiene información publicada.</p>
      ) : (
        <div className="mt-10">
          {faq.length > 0 && (
            <section aria-labelledby="flow-faq" className="mb-12">
              <h2 id="flow-faq" className="flow-label mb-2">Preguntas frecuentes</h2>
              {faq.map((f, i) => <Accordion key={i} title={f.q}><p className="whitespace-pre-line">{f.a}</p></Accordion>)}
            </section>
          )}
          {(envios || cambios || guide) && (
            <section aria-labelledby="flow-politicas" className="mb-12">
              <h2 id="flow-politicas" className="flow-label mb-2">Pedidos</h2>
              {envios && <Accordion id="envios" title="Envíos"><p className="whitespace-pre-line">{envios}</p></Accordion>}
              {cambios && <Accordion id="cambios" title="Cambios y devoluciones"><p className="whitespace-pre-line">{cambios}</p></Accordion>}
              {guide && <Accordion id="guia-de-tallas" title={guide.title || 'Guía de tallas'}><SizeGuideTable guide={guide} /></Accordion>}
            </section>
          )}
          {hasContact && (
            <section aria-labelledby="flow-contacto" className="bg-flow-sand p-6 md:p-8">
              <h2 id="flow-contacto" className="flow-serif text-2xl">Contacto</h2>
              <ul className="mt-4 space-y-2 text-sm">
                {city && <li>{city}</li>}
                {email && <li><a href={`mailto:${email}`} className="underline">{email}</a></li>}
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
      )}
    </div>
  );
}
