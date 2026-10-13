import { Link, useLocation } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useBagValidation } from '../hooks/useBagValidation';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { formatCOP, shippingFor } from '../lib/format';
import { COPY } from '../lib/copy';
import BagLines from '../components/BagLines';

export default function BagPage() {
  const { slug, store } = useStore();
  const path = useStorePath();
  const location = useLocation();
  const { lines, subtotal } = useCart();
  const { loading, issues, blocking } = useBagValidation(slug, lines, true);
  useDocumentMeta(`${COPY.bag} — ${store.name || 'Flow'}`, 'Revisa tu bolsa antes de finalizar el pedido.');

  const soldOutNotice = location.state?.soldOut;
  const shipping = shippingFor(store, subtotal);
  const freeFrom = Number(store.free_shipping_from) || 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8">
      <h1 className="flow-display text-3xl">{COPY.bag}</h1>

      {soldOutNotice && (
        <p className="mt-6 border-l-2 border-[color:var(--flow-merlot)] pl-3 text-sm text-flow-merlot" role="alert">
          Algunos productos de tu bolsa ya no tienen unidades suficientes. Revísalos abajo y vuelve a intentarlo.
        </p>
      )}

      {lines.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-sm text-flow-muted mb-6">Tu bolsa está vacía.</p>
          <Link to={path('/coleccion')} className="flow-btn flow-btn-primary">Ver colección</Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-12 md:grid-cols-[1fr_320px]">
          <BagLines issues={issues} />
          <aside className="h-fit border border-flow-stone p-6">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCOP(subtotal)}</span></div>
            <div className="mt-2 flex justify-between text-sm">
              <span>Envío</span><span>{shipping === 0 ? 'Gratis' : formatCOP(shipping)}</span>
            </div>
            {freeFrom > 0 && subtotal < freeFrom && (
              <p className="mt-2 text-xs text-flow-muted">Te faltan {formatCOP(freeFrom - subtotal)} para envío gratis.</p>
            )}
            <hr className="flow-rule my-4" />
            <div className="flex justify-between"><span className="flow-label">Total estimado</span><span>{formatCOP(subtotal + shipping)}</span></div>
            <p className="mt-2 text-xs text-flow-muted">El total final lo confirmamos al recibir tu pedido.</p>
            <Link to={path('/checkout')} aria-disabled={blocking || loading}
              className={`flow-btn flow-btn-primary mt-6 w-full ${blocking || loading ? 'pointer-events-none opacity-40' : ''}`}>
              {loading ? 'Revisando tu bolsa...' : COPY.checkout}
            </Link>
            {blocking && <p className="mt-2 text-xs text-flow-merlot">Ajusta los productos marcados para continuar.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
