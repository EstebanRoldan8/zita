import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useCart } from '../hooks/cartContext';
import { useStore, useStorePath } from '../hooks/useStore';
import { useBagValidation } from '../hooks/useBagValidation';
import { formatCOP } from '../lib/format';
import { COPY } from '../lib/copy';
import SetDiscountRow from './SetDiscountRow';
import BagLines from './BagLines';

// Bolsa como panel lateral. Se revalida contra la API cada vez que se abre.
export default function BagDrawer() {
  const { slug } = useStore();
  const path = useStorePath();
  const { lines, subtotal, discount, open, setOpen } = useCart();
  const { loading, issues, blocking } = useBagValidation(slug, lines, open);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, setOpen]);

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`flow-fade absolute inset-0 ${open ? 'opacity-100' : 'opacity-0'}`}
        style={{ backgroundColor: 'rgba(28,28,28,0.3)' }} onClick={() => setOpen(false)} />
      <aside role="dialog" aria-modal="true" aria-label={COPY.bag}
        className={`flow-drawer absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-flow-white ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between border-b border-flow-stone px-6 py-4">
          <h2 className="flow-label">{COPY.bag}</h2>
          <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Cerrar la bolsa"
            className="-mr-3 flex h-11 w-11 items-center justify-center">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6">
          {lines.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-flow-muted mb-6">Tu bolsa está vacía.</p>
              <Link to={path('/coleccion')} onClick={() => setOpen(false)} className="flow-btn flow-btn-outline">Ver colección</Link>
            </div>
          ) : (
            <BagLines issues={issues} onNavigate={() => setOpen(false)} compact />
          )}
        </div>

        {lines.length > 0 && (
          <div className="border-t border-flow-stone px-6 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="flow-label">Subtotal</span>
              <span>{formatCOP(subtotal)}</span>
            </div>
            <SetDiscountRow amount={discount} className="mt-1" />
            <p className="mt-1 text-xs text-flow-muted">El envío y el total final se calculan al confirmar el pedido.</p>
            <div className="mt-4 grid gap-2">
              <Link to={path('/checkout')} onClick={() => setOpen(false)} aria-disabled={blocking || loading}
                className={`flow-btn flow-btn-primary w-full ${blocking || loading ? 'pointer-events-none opacity-40' : ''}`}>
                {loading ? 'Revisando tu bolsa...' : COPY.checkout}
              </Link>
              <Link to={path('/bolsa')} onClick={() => setOpen(false)} className="flow-btn flow-btn-outline w-full">Ver bolsa</Link>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
