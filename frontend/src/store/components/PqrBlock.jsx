import { Mail, MessageCircle, FileText } from 'lucide-react';
import { useStore } from '../hooks/useStore';
import { flowContent } from '../content/flowContent';
import { whatsappNumber, whatsappDisplay, pqrFormUrl } from '../lib/contact';
import { waLink } from '../lib/format';

// Peticiones, quejas y reclamos: botón del formulario solo si hay pqrFormUrl; siempre WhatsApp y correo.
// onDark: versión del footer (fondo negro)
export default function PqrBlock({ onDark = false, heading = true, className = '' }) {
  const { store } = useStore();
  const form = pqrFormUrl();
  const wa = waLink(whatsappNumber(store), 'Hola FLOW, quiero presentar una petición, queja o reclamo.');
  const shown = whatsappDisplay(store);
  const { email } = flowContent.brand;
  if (!form && !wa && !email) return null;
  const btn = onDark ? 'flow-btn flow-btn-light' : 'flow-btn flow-btn-primary';
  const outline = onDark ? 'flow-btn flow-btn-outline flow-btn-outline-light' : 'flow-btn flow-btn-outline';

  return (
    <div className={className}>
      {heading && <p className={`flow-label mb-3 ${onDark ? 'text-flow-stone' : ''}`}>Peticiones, quejas y reclamos</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {form && (
          <a href={form} target="_blank" rel="noopener noreferrer" className={btn}>
            <FileText size={16} strokeWidth={1.5} aria-hidden="true" /> Formulario de PQR
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={form ? outline : btn}>
            <MessageCircle size={16} strokeWidth={1.5} aria-hidden="true" /> WhatsApp {shown}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className={`${outline} [overflow-wrap:anywhere]`}>
            <Mail size={16} strokeWidth={1.5} aria-hidden="true" /> {email}
          </a>
        )}
      </div>
    </div>
  );
}
