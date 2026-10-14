import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Carrusel con CSS scroll-snap: en móvil se asoma la siguiente tarjeta (peek); en desktop hay flechas.
// Sin librerías. itemClass define el ancho de cada tarjeta por breakpoint.
export default function ProductCarousel({ label, children, itemClass = 'w-[72%] sm:w-[44%] md:w-[31%] lg:w-[23.5%]' }) {
  const ref = useRef(null);
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  const scroll = (dir) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  };
  if (items.length === 0) return null;

  return (
    <div className="relative" role="region" aria-label={label} aria-roledescription="carrusel">
      <div ref={ref} className="flow-snap relative -mx-4 flex scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0" tabIndex={0}>
        {items.map((child, i) => (
          <div key={child.key ?? i} className={`flex-shrink-0 ${itemClass}`}>{child}</div>
        ))}
      </div>
      {items.length > 2 && (
        <div className="mt-6 hidden justify-end gap-2 md:flex">
          <button type="button" onClick={() => scroll(-1)} aria-label="Anteriores"
            className="flex h-11 w-11 items-center justify-center border border-flow-black hover:bg-flow-black hover:text-flow-white">
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label="Siguientes"
            className="flex h-11 w-11 items-center justify-center border border-flow-black hover:bg-flow-black hover:text-flow-white">
            <ChevronRight size={18} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
