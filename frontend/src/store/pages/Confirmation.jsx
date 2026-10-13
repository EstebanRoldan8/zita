import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useStore, useStorePath } from '../hooks/useStore';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { storeApi } from '../lib/storeApi';
import { formatCOP, STATUS_LABELS } from '../lib/format';
import { COPY } from '../lib/copy';
import { ErrorState } from '../components/States';

// Confirmación. Llega con el pedido en location.state; si se recarga, consulta el estado público.
export default function Confirmation() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const phone = params.get('phone') || '';
  const { slug, store } = useStore();
  const path = useStorePath();
  const { state } = useLocation();
  useDocumentMeta(`Pedido recibido — ${store.name || 'Flow'}`, COPY.thanks);

  const fresh = state?.order?.id === orderId ? state : null;
  const status = useQuery({
    queryKey: ['store', slug, 'order', orderId, phone],
    queryFn: () => storeApi.getOrderStatus(slug, orderId, phone),
    enabled: !fresh && !!phone,
    retry: (count, err) => err?.response?.status !== 404 && count < 1,
  });

  if (!fresh && (status.isLoading)) {
    return <div className="mx-auto max-w-2xl px-4 py-16"><div className="flow-skeleton h-8 w-2/3" /><div className="flow-skeleton mt-6 h-40" /></div>;
  }
  if (!fresh && (!phone || status.error?.response?.status === 404)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="flow-serif text-2xl">No encontramos este pedido</h1>
        <p className="mt-3 text-sm text-flow-muted">Revisa el enlace o escríbenos por WhatsApp.</p>
        <Link to={path('/')} className="flow-btn flow-btn-outline mt-8">Volver al inicio</Link>
      </div>
    );
  }
  if (!fresh && status.isError) return <ErrorState message="No pudimos consultar tu pedido." onRetry={status.refetch} />;

  const code = fresh ? fresh.order.code : status.data.code;
  const total = fresh ? fresh.order.total : status.data.total;
  const statusLabel = STATUS_LABELS[fresh ? fresh.order.status : status.data.status] || 'Recibido';
  const items = fresh
    ? fresh.lines.map((l) => ({ text: `${l.name}${[l.color, l.size].filter(Boolean).length ? ` (${[l.color, l.size].filter(Boolean).join(' / ')})` : ''}`, quantity: l.quantity }))
    : status.data.items.map((i) => ({ text: i.description, quantity: i.quantity }));

  // Al recargar no tenemos whatsapp_url: se arma un enlace simple con el código
  const whatsappUrl = fresh?.whatsapp_url
    || (store.whatsapp_number ? `https://wa.me/${store.whatsapp_number}?text=${encodeURIComponent(`Hola, quiero confirmar mi pedido ${code}.`)}` : null);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center md:py-24">
      <p className="flow-label text-flow-muted">Pedido {code}</p>
      <h1 className="flow-serif mt-4 text-3xl md:text-4xl">{COPY.thanks}</h1>
      <p className="mt-4 text-sm text-flow-muted">Estado: {statusLabel}. Te escribimos por WhatsApp para coordinar el pago y el envío.</p>

      <div className="mt-10 border border-flow-stone p-6 text-left">
        <ul className="space-y-2 text-sm">
          {items.map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3"><span>{i.text}</span><span className="flex-shrink-0">× {i.quantity}</span></li>
          ))}
        </ul>
        <hr className="flow-rule my-4" />
        {fresh && (
          <div className="mb-2 flex justify-between text-sm">
            <span>Envío</span><span>{Number(fresh.order.shipping_cost) === 0 ? 'Gratis' : formatCOP(fresh.order.shipping_cost)}</span>
          </div>
        )}
        <div className="flex justify-between"><span className="flow-label">Total</span><span>{formatCOP(total)}</span></div>
      </div>

      {whatsappUrl && (
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flow-btn flow-btn-primary mt-10 w-full sm:w-auto">
          {COPY.confirmWhatsapp}
        </a>
      )}
      <div className="mt-4">
        <Link to={path('/coleccion')} className="flow-label border-b border-flow-black pb-1">Seguir comprando</Link>
      </div>
      <p className="flow-script mt-16 text-4xl">{COPY.slogan}</p>
    </div>
  );
}
