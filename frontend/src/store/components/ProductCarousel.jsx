import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Carrusel con CSS scroll-snap: en móvil se asoma la siguiente tarjeta (peek); en desktop hay flechas.
// Sin librerías. itemClass define el ancho de cada tarjeta por breakpoint. onDark: flechas claras sobre fondo oscuro.
// Las flechas solo aparecen si el contenido no cabe y se deshabilitan en los extremos. Con el carrusel enfocado,
// ← → mueven una tarjeta e Inicio/Fin van a los extremos.
export default function ProductCarousel({ label, children, itemClass = 'w-[72%] sm:w-[44%] md:w-[31%] lg:w-[23.5%]', onDark = false }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ overflow: false, prev: false, next: false });
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { overflow: max > 1, prev: el.scrollLeft > 1, next: el.scrollLeft < max - 1 };
    setEdges((e) => (e.overflow === next.overflow && e.prev === next.prev && e.next === next.next ? e : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, [update, items.length]);

  const behavior = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const scroll = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: behavior() });
  };
  const onKeyDown = (e) => {
    const el = ref.current;
    if (!el || e.target !== el) return;
    const step = el.firstElementChild?.getBoundingClientRect().width || el.clientWidth * 0.8;
    const moves = { ArrowRight: step, ArrowLeft: -step, Home: -el.scrollWidth, End: el.scrollWidth };
    if (!(e.key in moves)) return;
    e.preventDefault();
    el.scrollBy({ left: moves[e.key], behavior: behavior() });
  };
  if (items.length === 0) return null;

  const arrow = `flex h-11 w-11 items-center justify-center border disabled:cursor-default disabled:opacity-30 ${onDark ? 'border-[color:var(--flow-sand)]' : 'border-flow-black hover:bg-flow-black hover:text-flow-white disabled:hover:bg-transparent disabled:hover:text-current'}`;

  return (
    <div className="relative" role="region" aria-label={label} aria-roledescription="carrusel">
      <div ref={ref} onKeyDown={onKeyDown} className="flow-snap relative -mx-4 flex scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:scroll-px-0 md:px-0" tabIndex={0}>
        {items.map((child, i) => (
          <div key={child.key ?? i} className={`flex-shrink-0 ${itemClass}`}>{child}</div>
        ))}
      </div>
      {edges.overflow && (
        <div className="mt-6 hidden justify-end gap-2 md:flex">
          <button type="button" onClick={() => scroll(-1)} aria-label="Anteriores" disabled={!edges.prev} className={arrow}>
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => scroll(1)} aria-label="Siguientes" disabled={!edges.next} className={arrow}>
            <ChevronRight size={18} strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
