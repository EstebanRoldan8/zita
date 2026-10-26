import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useStore, useStorePath } from '../hooks/useStore';
import { useSeo } from '../hooks/useSeo';
import { privateSeo } from '../lib/seo';
import { storeApi } from '../lib/storeApi';
import { formatCOP, STATUS_LABELS } from '../lib/format';
import { asArray, asObject, asString } from '../lib/safe';
import { COPY } from '../lib/copy';
import { flowContent } from '../content/flowContent';
import { paymentLabel, paymentShort } from '../lib/paymentMethods';
import { ErrorState } from '../components/States';

// Confirmación. Llega con el pedido en location.state; si se recarga, consulta el estado público.
export default function Confirmation() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const phone = params.get('phone') || '';
  const { slug, store } = useStore();
  const path = useStorePath();
  const { state } = useLocation();
  useSeo(privateSeo('Pedido recibido'));

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

  // Datos del estado de navegación o de la consulta pública, leídos de forma defensiva
  const source = fresh ? asObject(fresh.order) : asObject(status.data);
  const code = asString(source.code, '');
  const total = source.total;
  const statusLabel = STATUS_LABELS[source.status] || 'Recibido';
  const items = fresh
    ? asArray(fresh.lines).filter(Boolean).map((l) => ({ text: `${asString(l.name, 'Producto')}${[l.color, l.size].filter(Boolean).length ? ` (${[l.color, l.size].filter(Boolean).join(' / ')})` : ''}`, quantity: l.quantity }))
    : asArray(source.items).filter(Boolean).map((i) => ({ text: asString(i.description, 'Producto'), quantity: i.quantity }));

  // Número: el de la tienda (store_settings) y, si está vacío, el oficial de FLOW. El mensaje lleva el
  // número de pedido; se arma aquí para que sea igual al recargar la página.
  const method = fresh ? fresh.payment_method : source.payment_method;
  const waNumber = String(store.whatsapp_number || flowContent.brand.whatsapp || '').replace(/[^0-9]/g, '');
  const whatsappUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola FLOW, hice el pedido ${code}${paymentShort(method) ? ` (pago por ${paymentShort(method)})` : ''} y quiero recibir los datos de pago.`)}`
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center md:py-24">
      <p className="flow-label text-flow-muted">Pedido {code}</p>
      <h1 className="flow-serif mt-4 text-3xl md:text-4xl">{COPY.thanks}</h1>
      <p className="mt-4 text-sm text-flow-muted">Estado: {statusLabel}. {COPY.confirmPayment}</p>

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
        {paymentLabel(method) && (
          <div className="mt-2 flex justify-between text-sm"><span>Método de pago</span><span>{paymentLabel(method)}</span></div>
        )}
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
