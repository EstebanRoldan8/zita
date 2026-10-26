import { useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { waLink } from '../lib/format';
import { whatsappNumber } from '../lib/contact';

// Botón flotante de WhatsApp (48 px). No se muestra sin número ni en el checkout.
// En la página de producto el mensaje incluye el nombre del producto (lo publica ProductPage en
// body[data-flow-product]) y en móvil sube por encima del botón fijo "Agregar a la bolsa".
export default function WhatsAppFab() {
  const { store } = useStore();
  const location = useLocation();
  const number = whatsappNumber(store);
  const base = waLink(number);
  if (!base || /\/checkout\/?$/.test(location.pathname)) return null;

  const onClick = (e) => {
    const product = document.body.dataset.flowProduct;
    const text = product ? `Hola FLOW, tengo una pregunta sobre ${product}.` : 'Hola FLOW, tengo una pregunta.';
    e.currentTarget.href = waLink(number, text);
  };

  return (
    <a href={waLink(number, 'Hola FLOW, tengo una pregunta.')} onClick={onClick}
      target="_blank" rel="noopener noreferrer" aria-label="Escríbenos por WhatsApp"
      className="flow-wa-fab fixed bottom-5 right-4 z-40 flex h-12 w-12 items-center justify-center rounded border border-[color:var(--flow-sand)] bg-flow-black text-flow-white md:bottom-8 md:right-8">
      <MessageCircle size={22} strokeWidth={1.5} aria-hidden="true" />
    </a>
  );
}
