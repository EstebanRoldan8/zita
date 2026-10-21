import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, X } from 'lucide-react';
import { flowContent } from '../../content/flowContent';
import ProductCarousel from '../ProductCarousel';

// Reels de Instagram de la portada. Al abrir la página no se carga nada de Instagram: las tarjetas
// son locales (portada o tarjeta oscura) y el iframe del reel solo se crea al abrir el modal.
const CODE_RE = /^[A-Za-z0-9_-]+$/;
const reelUrl = (code) => `https://www.instagram.com/reel/${code}/`;
const embedUrl = (code) => `${reelUrl(code)}embed`;
// Fondos de las tarjetas sin portada (paleta de la marca)
const TONES = [
  'linear-gradient(160deg, #19212C 0%, #1C1C1C 100%)',
  'linear-gradient(160deg, #5C1923 0%, #1C1C1C 100%)',
  'linear-gradient(160deg, #12163A 0%, #0B0B10 100%)',
];

function ReelCard({ reel, index, onOpen }) {
  const label = reel.title || `Reel ${index + 1} de FLOW`;
  return (
    <button type="button" onClick={(e) => onOpen(reel, e.currentTarget)} aria-haspopup="dialog"
      aria-label={`Ver ${label}`} className="group block w-full text-left">
      <div className="relative aspect-[9/16] overflow-hidden" style={{ background: TONES[index % TONES.length] }}>
        {reel.cover && (
          <img src={reel.cover} alt="" width="720" height="1280" loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-flow-white">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border transition-colors group-hover:bg-flow-white group-hover:text-flow-black"
            style={{ borderColor: 'rgba(255,255,255,0.8)', backgroundColor: reel.cover ? 'rgba(28,28,28,0.25)' : undefined }}>
            <Play size={20} strokeWidth={1.5} className="ml-0.5" aria-hidden="true" />
          </span>
          {!reel.cover && <span className="flow-label text-flow-sand">Ver reel</span>}
        </span>
      </div>
      {reel.title && <p className="mt-3 text-sm">{reel.title}</p>}
    </button>
  );
}

function ReelModal({ reel, onClose }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      // Foco atrapado dentro del modal
      const items = [...dialogRef.current.querySelectorAll('button, a[href], iframe')];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; clearTimeout(timer); };
  }, [onClose]);

  const label = reel.title || 'Reel de FLOW';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}
      style={{ backgroundColor: 'rgba(28,28,28,0.8)' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[400px] flex-col overflow-y-auto bg-flow-white">
        <div className="flex items-center justify-between border-b border-flow-stone py-1 pl-4 pr-1">
          <p className="flow-label">{flowContent.instagram?.handle || 'Instagram'}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar el reel"
            className="flex h-11 w-11 items-center justify-center">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <div className="relative flex-none bg-flow-sand" style={{ height: 'min(640px, calc(100dvh - 10rem))' }}>
          {!loaded && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-flow-muted" aria-live="polite">
              {slow ? '¿No carga? Ábrelo en Instagram.' : 'Cargando reel…'}
            </p>
          )}
          <iframe src={embedUrl(reel.code)} title={label} onLoad={() => setLoaded(true)}
            allow="autoplay; encrypted-media; picture-in-picture; clipboard-write" allowFullScreen
            className="relative h-full w-full border-0" />
        </div>
        <div className="border-t border-flow-stone p-3">
          <a href={reelUrl(reel.code)} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-primary w-full">
            Abrir en Instagram
          </a>
        </div>
      </div>
    </div>
  );
}

export default function InstagramReels() {
  const ig = flowContent.instagram;
  const reels = (ig?.reels || []).filter((r) => r && CODE_RE.test(String(r.code || '')));
  const [open, setOpen] = useState(null);
  const triggerRef = useRef(null);
  // Estable: si cambiara en cada render, el efecto del modal se repetiría y movería el foco
  const close = useCallback(() => { setOpen(null); triggerRef.current?.focus(); }, []);
  if (reels.length === 0) return null;

  const openReel = (reel, trigger) => { triggerRef.current = trigger; setOpen(reel); };

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24" aria-labelledby="flow-instagram">
      <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <h2 id="flow-instagram" className="flow-serif text-3xl md:text-4xl">{ig.title}</h2>
        {ig.url && (
          <a href={ig.url} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-outline self-start md:self-auto">
            {ig.handle || 'Instagram'}
          </a>
        )}
      </div>
      <ProductCarousel label="Reels de Instagram" itemClass="w-[62%] sm:w-[40%] md:w-[30%] lg:w-[18.6%]">
        {reels.map((r, i) => <ReelCard key={r.code} reel={r} index={i} onOpen={openReel} />)}
      </ProductCarousel>
      {open && <ReelModal reel={open} onClose={close} />}
    </section>
  );
}
