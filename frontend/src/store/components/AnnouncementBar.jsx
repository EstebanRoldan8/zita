import { useEffect, useState } from 'react';
import { useStore } from '../hooks/useStore';
import { flowContent } from '../content/flowContent';
import { formatCOP } from '../lib/format';

const INTERVAL = 5000;

// Barra superior con mensajes rotativos (cada 5 s, pausa con hover/foco).
// El mensaje de envío gratis se arma con store_settings y se omite si no hay dato.
export default function AnnouncementBar() {
  const { store } = useStore();
  const freeFrom = Number(store?.free_shipping_from) || 0;
  const messages = [
    ...(Array.isArray(flowContent.announcement) ? flowContent.announcement : []),
    freeFrom > 0 ? `Envío gratis desde ${formatCOP(freeFrom)}` : null,
  ].filter((m) => typeof m === 'string' && m.trim());

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || messages.length < 2) return undefined;
    const t = setInterval(() => setIndex((i) => (i + 1) % messages.length), INTERVAL);
    return () => clearInterval(t);
  }, [paused, messages.length]);

  if (messages.length === 0) return null;
  const current = messages[index % messages.length];

  return (
    <div data-flow-announce className="bg-flow-black text-flow-sand flow-on-dark"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="mx-auto flex h-9 max-w-7xl items-center justify-center px-4">
        <p key={current} className="flow-label flow-announce truncate text-center" style={{ fontSize: '11px' }} aria-live="polite">
          {current}
        </p>
      </div>
    </div>
  );
}
