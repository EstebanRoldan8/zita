import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useBagValidation } from '../hooks/useBagValidation';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { storeApi, apiErrorMessage } from '../lib/storeApi';
import { formatCOP, normalizePhone, isEmail, newIdempotencyKey, shippingFor } from '../lib/format';
import { COPY } from '../lib/copy';

// Métodos ofrecidos según el texto payment_methods de la tienda. "Contraentrega" envía 'efectivo'
// (es el valor que acepta la API). Nunca hay formulario de tarjeta.
const METHOD_OPTIONS = [
  { value: 'transferencia', label: 'Transferencia', match: /transfer/i },
  { value: 'nequi', label: 'Nequi', match: /nequi/i },
  { value: 'efectivo', label: 'Efectivo / contraentrega', match: /efectivo|contra\s*entrega/i },
];

function methodsFor(text) {
  const matched = METHOD_OPTIONS.filter((m) => m.match.test(String(text || '')));
  return matched.length > 0 ? matched : METHOD_OPTIONS;
}

function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="flow-label mb-2 block">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="mt-1 text-xs text-flow-merlot">{error}</p>
        : hint ? <p className="mt-1 text-xs text-flow-muted">{hint}</p> : null}
    </div>
  );
}

export default function Checkout() {
  const { slug, store } = useStore();
  const path = useStorePath();
  const navigate = useNavigate();
  const { lines, subtotal, clear } = useCart();
  const { loading: validating, blocking } = useBagValidation(slug, lines, true);
  useDocumentMeta(`${COPY.checkout} — ${store.name || 'Flow'}`, 'Completa tus datos para finalizar el pedido.');

  const methods = methodsFor(store.payment_methods);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '', address: '', notes: '',
    payment_method: methods[0].value, accept: false, website: '',
  });
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  // Una clave por intento de compra; se reutiliza si el envío falla y el cliente reintenta
  const keyRef = useRef(null);

  if (lines.length === 0 && !submitting) return <Navigate to={path('/bolsa')} replace />;

  const phone = normalizePhone(form.phone);
  const errors = {
    name: form.name.trim().length < 2 ? 'Escribe tu nombre.' : form.name.trim().length > 80 ? 'Máximo 80 caracteres.' : '',
    phone: !phone ? 'Escribe un celular colombiano de 10 dígitos (ej. 300 123 4567).' : '',
    email: form.email.trim() && !isEmail(form.email) ? 'Revisa el correo.' : '',
    city: form.city.trim().length < 2 ? 'Escribe tu ciudad.' : '',
    address: form.address.trim().length < 5 ? 'Escribe la dirección completa (mínimo 5 caracteres).' : '',
    accept: !form.accept ? 'Debes aceptar el tratamiento de datos para continuar.' : '',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (k) => (touched[k] || touched.__submit) && errors[k];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const shipping = shippingFor(store, subtotal);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return; // anti doble clic
    setTouched((t) => ({ ...t, __submit: true }));
    setServerError('');
    if (hasErrors || blocking || validating) return;

    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    setSubmitting(true);
    try {
      const res = await storeApi.createOrder(slug, {
        items: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
        customer: { name: form.name.trim(), phone, ...(form.email.trim() ? { email: form.email.trim() } : {}) },
        shipping: { address: form.address.trim(), city: form.city.trim(), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) },
        payment_method: form.payment_method,
        idempotency_key: keyRef.current,
        website: form.website,
      });
      // 201 creado o 200 con duplicate:true (mismo intento): ambos son éxito
      const data = res.data?.data;
      const snapshot = lines.map((l) => ({ name: l.name, color: l.color, size: l.size, quantity: l.quantity, price: l.price }));
      keyRef.current = null;
      clear();
      navigate(`${path(`/pedido/${data.order.id}`)}?phone=${phone}`, {
        replace: true,
        state: { order: data.order, whatsapp_url: data.whatsapp_url, lines: snapshot },
      });
    } catch (err) {
      const body = err.response?.data;
      if (err.response?.status === 409 && body?.error === 'sin_stock') {
        keyRef.current = null; // el pedido no se creó: el próximo intento usa una clave nueva
        navigate(path('/bolsa'), { state: { soldOut: body.items || [] } });
        return;
      }
      if (err.response?.status === 400) keyRef.current = null;
      setServerError(apiErrorMessage(err, 'No pudimos crear tu pedido. Intenta de nuevo.'));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8">
      <h1 className="flow-display text-3xl">{COPY.checkout}</h1>
      <p className="mt-3 text-sm text-flow-muted">Compra como invitado. Te escribimos por WhatsApp para confirmar.</p>

      <form onSubmit={submit} noValidate className="mt-10 grid gap-12 md:grid-cols-[1fr_340px]">
        <div className="grid gap-6">
          {/* Honeypot: invisible para personas, los bots lo llenan */}
          <div className="flow-sr-only" aria-hidden="true">
            <label htmlFor="website">No llenar este campo</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
          </div>

          <Field id="f-name" label="Nombre completo" error={show('name')}>
            <input id="f-name" className="flow-input" autoComplete="name" maxLength={80} value={form.name}
              onChange={set('name')} onBlur={blur('name')} aria-invalid={!!show('name')} aria-describedby={show('name') ? 'f-name-error' : undefined} />
          </Field>
          <Field id="f-phone" label="WhatsApp" error={form.phone && !phone && touched.phone ? errors.phone : show('phone')}
            hint={phone ? 'Número válido.' : 'Celular colombiano de 10 dígitos.'}>
            <input id="f-phone" className="flow-input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={16}
              placeholder="300 123 4567" value={form.phone} onChange={set('phone')} onBlur={blur('phone')}
              aria-invalid={!!(touched.phone && !phone)} aria-describedby="f-phone-error" />
          </Field>
          <Field id="f-email" label="Correo (opcional)" error={show('email')}>
            <input id="f-email" className="flow-input" type="email" autoComplete="email" maxLength={254} value={form.email}
              onChange={set('email')} onBlur={blur('email')} aria-invalid={!!show('email')} />
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field id="f-city" label="Ciudad" error={show('city')}>
              <input id="f-city" className="flow-input" autoComplete="address-level2" maxLength={80} value={form.city}
                onChange={set('city')} onBlur={blur('city')} aria-invalid={!!show('city')} />
            </Field>
            <Field id="f-address" label="Dirección" error={show('address')}>
              <input id="f-address" className="flow-input" autoComplete="street-address" maxLength={200} value={form.address}
                onChange={set('address')} onBlur={blur('address')} aria-invalid={!!show('address')} />
            </Field>
          </div>
          <Field id="f-notes" label="Notas (opcional)" hint="Apartamento, barrio o indicaciones para la entrega.">
            <textarea id="f-notes" className="flow-input" rows={3} maxLength={300} value={form.notes} onChange={set('notes')} />
          </Field>

          <fieldset>
            <legend className="flow-label mb-3">Método de pago</legend>
            <div className="grid gap-2">
              {methods.map((m) => (
                <label key={m.value} className="flow-option justify-start">
                  <input type="radio" name="payment_method" value={m.value} checked={form.payment_method === m.value} onChange={set('payment_method')} />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-flow-muted">{COPY.paymentNote}</p>
          </fieldset>

          <div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={form.accept} onChange={set('accept')} className="mt-1 h-5 w-5 accent-[#1C1C1C]"
                aria-invalid={!!show('accept')} aria-describedby={show('accept') ? 'f-accept-error' : undefined} />
              <span>
                Autorizo el tratamiento de mis datos personales para gestionar mi pedido, según la Ley 1581 de 2012 y la{' '}
                <Link to={path('/privacidad')} className="underline" target="_blank">política de privacidad</Link>.
              </span>
            </label>
            {show('accept') && <p id="f-accept-error" className="mt-1 text-xs text-flow-merlot">{errors.accept}</p>}
          </div>
        </div>

        <aside className="h-fit border border-flow-stone p-6">
          <h2 className="flow-label mb-4">Resumen</h2>
          <ul className="space-y-3 text-sm">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span className="min-w-0">{l.quantity} × {l.name}{[l.color, l.size].filter(Boolean).length ? ` (${[l.color, l.size].filter(Boolean).join(' / ')})` : ''}</span>
                <span className="flex-shrink-0">{formatCOP(l.price * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <hr className="flow-rule my-4" />
          <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCOP(subtotal)}</span></div>
          <div className="mt-2 flex justify-between text-sm"><span>Envío</span><span>{shipping === 0 ? 'Gratis' : formatCOP(shipping)}</span></div>
          {Number(store.free_shipping_from) > 0 && (
            <p className="mt-1 text-xs text-flow-muted">Gratis desde {formatCOP(store.free_shipping_from)}.</p>
          )}
          <hr className="flow-rule my-4" />
          <div className="flex justify-between"><span className="flow-label">Total</span><span>{formatCOP(subtotal + shipping)}</span></div>
          <p className="mt-2 text-xs text-flow-muted">El total final lo calcula la tienda al recibir tu pedido.</p>

          {serverError && <p className="mt-4 text-sm text-flow-merlot" role="alert">{serverError}</p>}
          {blocking && <p className="mt-4 text-sm text-flow-merlot">Hay productos en tu bolsa que cambiaron. <Link to={path('/bolsa')} className="underline">Revisa tu bolsa</Link>.</p>}

          <button type="submit" disabled={submitting || validating || blocking} className="flow-btn flow-btn-primary mt-6 w-full">
            {submitting ? 'Enviando tu pedido...' : validating ? 'Revisando tu bolsa...' : COPY.checkout}
          </button>
        </aside>
      </form>
    </div>
  );
}
