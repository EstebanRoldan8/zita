import { Link } from 'react-router-dom';
import { Minus, Plus, X } from 'lucide-react';
import { useCart } from '../hooks/cartContext';
import { useStorePath } from '../hooks/useStore';
import { formatCOP } from '../lib/format';
import StoreImage from './StoreImage';

// Foto de 80-96 px: la versión de 400 cubre hasta DPR 3
const THUMB_WIDTHS = [400];

// Ítems de la bolsa: foto, talla/color, cantidad editable, quitar y avisos de revalidación.
export default function BagLines({ issues = {}, onNavigate, compact = false }) {
  const { lines, setQuantity, update, remove } = useCart();
  const path = useStorePath();

  return (
    <ul className="divide-y divide-[color:var(--flow-sand)]">
      {(Array.isArray(lines) ? lines : []).map((l) => {
        const issue = issues[l.key];
        const max = issue?.maxQty ?? l.max_qty ?? 10;
        const detail = [l.color, l.size].filter(Boolean).join(' / ');
        return (
          <li key={l.key} className="flex gap-4 py-5">
            <Link to={path(`/producto/${l.product_id}`)} onClick={onNavigate} className={`flow-photo flex-shrink-0 ${compact ? 'w-20' : 'w-24'}`}>
              {l.image ? <StoreImage src={l.image} alt={l.name} width="96" height="120" widths={THUMB_WIDTHS} baseWidth={400} sizes="96px" /> : null}
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{l.name}</p>
                  {detail && <p className="mt-1 text-xs text-flow-muted">{detail}</p>}
                  {l.includes && <p className="mt-0.5 text-xs text-flow-muted">Incluye: {l.includes}</p>}
                </div>
                <button type="button" onClick={() => remove(l.key)} aria-label={`Quitar ${l.name} de la bolsa`}
                  className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center text-flow-muted hover:text-flow-black">
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center border border-flow-stone" role="group" aria-label={`Cantidad de ${l.name}`}>
                  <button type="button" onClick={() => setQuantity(l.key, l.quantity - 1)} disabled={l.quantity <= 1}
                    aria-label="Quitar una unidad" className="flex h-10 w-10 items-center justify-center disabled:opacity-30">
                    <Minus size={14} strokeWidth={1.5} />
                  </button>
                  <span className="w-8 text-center text-sm" aria-live="polite">{l.quantity}</span>
                  <button type="button" onClick={() => setQuantity(l.key, l.quantity + 1)} disabled={l.quantity >= max}
                    aria-label="Agregar una unidad" className="flex h-10 w-10 items-center justify-center disabled:opacity-30">
                    <Plus size={14} strokeWidth={1.5} />
                  </button>
                </div>
                <p className="text-sm">{formatCOP((Number(l.price) || 0) * l.quantity)}</p>
              </div>

              {issue?.text && (
                <div className="mt-3 border-l-2 border-[color:var(--flow-merlot)] pl-3 text-xs" role="status">
                  <p className="text-flow-merlot">{issue.text}</p>
                  {issue.type === 'price' && (
                    <button type="button" className="mt-1 underline" onClick={() => update(l.key, { price: issue.price })}>
                      Precio actual: {formatCOP(issue.price)}. Actualizar
                    </button>
                  )}
                  {issue.type === 'qty' && (
                    <button type="button" className="mt-1 underline" onClick={() => setQuantity(l.key, issue.maxQty)}>
                      Dejar {issue.maxQty} {issue.maxQty === 1 ? 'unidad' : 'unidades'}
                    </button>
                  )}
                  {['soldout', 'gone', 'error'].includes(issue.type) && (
                    <button type="button" className="mt-1 underline" onClick={() => remove(l.key)}>Quitar de la bolsa</button>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
