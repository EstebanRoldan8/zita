import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useStore, useStorePath } from '../hooks/useStore';
import { useCart } from '../hooks/cartContext';
import { useBagValidation } from '../hooks/useBagValidation';
import { useSeo } from '../hooks/useSeo';
import { privateSeo } from '../lib/seo';
import { storeApi } from '../lib/storeApi';
import { formatCOP, normalizePhone, isEmail, newIdempotencyKey, shippingFor, isLocalCity } from '../lib/format';
import { COPY, PRIVACY_NOTICE } from '../lib/copy';

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

// Orden visual de los campos (para llevar el scroll al primer error) y su id en el DOM
const FIELD_ORDER = ['name', 'phone', 'email', 'city', 'address', 'notes', 'payment_method'];
// Casillas del paso de revisión, en orden visual
const CONSENT_ORDER = ['terms', 'dataAuth', 'marketingEmail'];
const FIELD_IDS = {
  name: 'f-name', phone: 'f-phone', email: 'f-email', city: 'f-city', address: 'f-address',
  notes: 'f-notes', payment_method: 'f-payment', terms: 'f-terms', dataAuth: 'f-data-auth', marketingEmail: 'f-mkt-email',
};
const FIELD_LABELS = {
  name: 'Nombre', phone: 'WhatsApp', email: 'Correo', city: 'Ciudad', address: 'Dirección',
  notes: 'Notas', payment_method: 'Método de pago', terms: 'Términos y condiciones', dataAuth: 'Tratamiento de datos',
  marketingEmail: 'Correo para novedades',
};
// Campo del body que reporta el backend (express-validator) → campo del formulario
const SERVER_FIELD = {
  'customer.name': 'name', 'customer.phone': 'phone', 'customer.email': 'email',
  'shipping.address': 'address', 'shipping.city': 'city', 'shipping.notes': 'notes',
  payment_method: 'payment_method',
  'consents.terms': 'terms', 'consents.data_auth': 'dataAuth',
};

function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="flow-label mb-2 block">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} className="mt-1 text-xs font-medium text-flow-merlot" role="alert">{error}</p>
        : hint ? <p className="mt-1 text-xs text-flow-muted">{hint}</p> : null}
    </div>
  );
}

function focusField(key) {
  const el = document.getElementById(FIELD_IDS[key]);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

const lineLabel = (l) => `${l.name}${[l.color, l.size].filter(Boolean).length ? ` (${[l.color, l.size].filter(Boolean).join(' / ')})` : ''}`;

export default function Checkout() {
  const { slug, store } = useStore();
  const path = useStorePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { lines, subtotal, clear, remove, setQuantity } = useCart();
  const { loading: validating, issues, blocking } = useBagValidation(slug, lines, true);
  useSeo(privateSeo(COPY.checkout));

  const methods = methodsFor(store.payment_methods);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', city: '', address: '', notes: '',
    payment_method: methods[0].value, terms: false, dataAuth: false, marketingWhatsapp: false, marketingEmail: false, website: '',
  });
  const [touched, setTouched] = useState({});
  const [step, setStep] = useState('form'); // 'form' → 'review' (resumen y casillas) → pedido
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null); // { text, items?, bagLink? } junto al botón
  const [serverErrors, setServerErrors] = useState({}); // errores 400 del servidor por campo
  // Una clave por intento de compra; se reutiliza si el envío falla por red y se reintenta
  const keyRef = useRef(null);

  if (lines.length === 0 && !submitting) return <Navigate to={path('/bolsa')} replace />;

  const phone = normalizePhone(form.phone);
  const errors = {
    name: form.name.trim().length < 2 ? 'Escribe tu nombre (mínimo 2 letras).' : form.name.trim().length > 80 ? 'Máximo 80 caracteres.' : '',
    phone: !form.phone.trim() ? 'Escribe tu WhatsApp.'
      : !phone ? 'Debe ser un celular colombiano de 10 dígitos que empiece por 3 (ej. 300 123 4567).' : '',
    email: form.email.trim() && !isEmail(form.email) ? 'Revisa el correo (ej. nombre@correo.com).' : '',
    city: form.city.trim().length < 2 ? 'Escribe tu ciudad.' : '',
    address: form.address.trim().length < 5 ? 'Escribe la dirección completa (mínimo 5 caracteres).' : '',
    notes: '',
    payment_method: methods.some((m) => m.value === form.payment_method) ? '' : 'Elige un método de pago.',
    terms: !form.terms ? 'Debes aceptar los Términos y condiciones y la Política de cambios para continuar.' : '',
    dataAuth: !form.dataAuth ? 'Debes autorizar el tratamiento de tus datos personales para continuar.' : '',
    marketingEmail: form.marketingEmail && !form.email.trim() ? 'Escribe tu correo en el formulario para recibir novedades por correo.' : '',
  };
  // Mensaje visible de un campo: error del servidor o error local (si ya se tocó o se intentó enviar)
  const fieldError = (k) => serverErrors[k] || ((touched[k] || submitted) ? errors[k] : '');
  const invalidKeys = FIELD_ORDER.filter((k) => errors[k]);
  const invalidConsents = CONSENT_ORDER.filter((k) => errors[k]);

  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    if (serverErrors[k]) setServerErrors((s) => ({ ...s, [k]: '' }));
    if (notice) setNotice(null);
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const shipping = shippingFor(store, subtotal, form.city);
  const local = isLocalCity(store, form.city);
  const blockingLines = lines.filter((l) => ['gone', 'soldout', 'qty', 'error'].includes(issues[l.key]?.type));

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return; // anti doble clic
    setSubmitted(true);
    setNotice(null);

    // 1) Campos: mensaje bajo cada uno, resumen junto al botón y scroll al primero
    if (invalidKeys.length > 0) {
      if (step !== 'form') setStep('form');
      setNotice({ text: `Revisa: ${invalidKeys.map((k) => FIELD_LABELS[k]).join(', ')}.` });
      setTimeout(() => focusField(invalidKeys[0]), 0);
      return;
    }
    // Paso 1 → paso 2: resumen completo antes de confirmar (se puede volver a corregir)
    if (step === 'form') {
      setStep('review');
      setSubmitted(false);
      window.scrollTo({ top: 0 });
      return;
    }
    // Casillas obligatorias: sin ellas no se puede confirmar (el servidor también las exige)
    if (invalidConsents.length > 0) {
      setNotice({ text: `Revisa: ${invalidConsents.map((k) => FIELD_LABELS[k]).join(', ')}.` });
      focusField(invalidConsents[0]);
      return;
    }
    // 2) Bolsa todavía revisándose o con productos que cambiaron: se explica junto al botón
    if (validating) {
      setNotice({ text: 'Estamos revisando la disponibilidad de tu bolsa. Intenta de nuevo en unos segundos.' });
      return;
    }
    if (blocking) {
      // El detalle con "Quitar" ya está visible junto al botón (bloque de productos con problemas)
      setNotice({ text: 'Ajusta los productos marcados antes de finalizar el pedido.' });
      document.getElementById('f-bag-issues')?.scrollIntoView({ block: 'center' });
      return;
    }

    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    setSubmitting(true);
    try {
      const res = await storeApi.createOrder(slug, {
        items: lines.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity })),
        customer: { name: form.name.trim(), phone, ...(form.email.trim() ? { email: form.email.trim() } : {}) },
        shipping: { address: form.address.trim(), city: form.city.trim(), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) },
        payment_method: form.payment_method,
        consents: { terms: form.terms, data_auth: form.dataAuth, marketing_whatsapp: form.marketingWhatsapp, marketing_email: form.marketingEmail },
        idempotency_key: keyRef.current,
        website: form.website,
      });
      // 201 creado o 200 con duplicate:true (mismo intento): ambos son éxito.
      // La bolsa se vacía SOLO aquí, cuando el pedido existe.
      const data = res.data?.data;
      if (!data?.order?.id) throw new Error('respuesta_sin_pedido');
      const snapshot = lines.map((l) => ({ name: l.name, color: l.color, size: l.size, quantity: l.quantity, price: l.price }));
      keyRef.current = null;
      clear();
      navigate(`${path(`/pedido/${data.order.id}`)}?phone=${phone}`, {
        replace: true,
        state: { order: data.order, whatsapp_url: data.whatsapp_url, lines: snapshot },
      });
    } catch (err) {
      setSubmitting(false);
      const status = err.response?.status;
      const body = err.response?.data || {};

      // 409 sin_stock o 400 de productos: el pedido no se creó; lista de lo afectado
      if ((status === 409 && body.error === 'sin_stock')
        || (status === 400 && ['producto_no_disponible', 'variante_no_disponible'].includes(body.error))) {
        keyRef.current = null;
        const ids = new Set(body.items || []);
        const affected = lines.filter((l) => ids.has(l.variant_id) || ids.has(l.product_id));
        setNotice({
          text: body.error === 'sin_stock'
            ? 'Estos productos ya no tienen unidades suficientes:'
            : 'Estos productos ya no están disponibles:',
          // Con sets, el servidor dice qué pieza falta ("Licra Aria Negro / S")
          items: [...(affected.length ? affected : lines).map(lineLabel), ...(Array.isArray(body.missing) ? body.missing.map((m) => `Falta: ${m}`) : [])],
          bagLink: true,
        });
        qc.invalidateQueries({ queryKey: ['store', slug, 'product'] }); // la bolsa se revalida
        return;
      }

      // 400 con campo: el mensaje va bajo ese campo
      if (status === 400 && body.field && SERVER_FIELD[body.field]) {
        keyRef.current = null;
        const key = SERVER_FIELD[body.field];
        setServerErrors((s) => ({ ...s, [key]: body.error || 'Revisa este campo.' }));
        setNotice({ text: `Revisa: ${FIELD_LABELS[key]}.` });
        if (!CONSENT_ORDER.includes(key)) setStep('form');
        setTimeout(() => focusField(key), 0);
        return;
      }
      if (status === 400) keyRef.current = null;
      if (status === 429) {
        setNotice({ text: body.error || 'Demasiados intentos. Espera un minuto e intenta de nuevo.' });
        return;
      }
      // Red o error del servidor: se conserva la clave para que el reintento no duplique
      setNotice({
        text: !err.response
          ? 'No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.'
          : 'No pudimos crear tu pedido, intenta de nuevo.',
      });
    }
  };

  const notices = (
    <>
      {/* Toda razón por la que no se envía aparece aquí, junto al botón */}
      {notice && (
        <div className="mt-4 border-l-2 border-[color:var(--flow-merlot)] pl-3 text-sm text-flow-merlot" role="alert">
          <p>{notice.text}</p>
          {notice.items?.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {notice.items.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          {notice.bagLink && <Link to={path('/bolsa')} className="mt-2 inline-block text-xs underline">Ir a mi bolsa</Link>}
        </div>
      )}
      {/* Productos que no se pueden pedir (borrados, agotados, sin cupo): aviso y "Quitar" aquí mismo */}
      {blockingLines.length > 0 && (
        <div id="f-bag-issues" className="mt-4 border border-[color:var(--flow-merlot)] p-3 text-sm" role="alert">
          <p className="text-flow-merlot">Estos productos no se pueden pedir así:</p>
          <ul className="mt-2 space-y-2">
            {blockingLines.map((l) => (
              <li key={l.key} className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0">
                  <span className="font-medium">{lineLabel(l)}</span>
                  <span className="block text-flow-merlot">{issues[l.key]?.text || 'Ya no está disponible.'}</span>
                </span>
                {issues[l.key]?.type === 'qty' ? (
                  <button type="button" onClick={() => setQuantity(l.key, issues[l.key].maxQty)}
                    className="flex-shrink-0 underline">Dejar {issues[l.key].maxQty}</button>
                ) : (
                  <button type="button" onClick={() => remove(l.key)} className="flex-shrink-0 underline">Quitar</button>
                )}
              </li>
            ))}
          </ul>
          <Link to={path('/bolsa')} className="mt-2 inline-block text-xs underline">Ir a mi bolsa</Link>
        </div>
      )}
    </>
  );

  const backToForm = () => { setStep('form'); setNotice(null); window.scrollTo({ top: 0 }); };
  const consentError = (k, id) => fieldError(k) && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-flow-merlot" role="alert">{fieldError(k)}</p>;
  const methodLabel = methods.find((m) => m.value === form.payment_method)?.label || form.payment_method;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 md:px-8">
      <h1 className="flow-display text-3xl">{step === 'review' ? 'Revisa tu pedido' : COPY.checkout}</h1>
      <p className="mt-3 text-sm text-flow-muted">
        {step === 'review' ? 'Confirma que todo esté bien. Si algo no es correcto, puedes corregirlo antes de confirmar.'
          : 'Compra como invitado. Te escribimos por WhatsApp para confirmar.'}
      </p>

      <form onSubmit={submit} noValidate className={step === 'review' ? 'mt-10' : 'mt-10 grid gap-12 md:grid-cols-[1fr_340px]'}>
        {/* Honeypot: invisible para personas, los bots lo llenan. autocomplete y los data-*
            evitan que el autollenado o los gestores de contraseñas lo completen solos. */}
        <div className="flow-sr-only" aria-hidden="true">
          <label htmlFor="flow-hp">No llenar este campo</label>
          <input id="flow-hp" name="website" type="text" tabIndex={-1} autoComplete="new-password"
            data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"
            value={form.website} onChange={set('website')} />
        </div>

        {step === 'form' && (
          <>
            <div className="grid gap-6">
              <Field id="f-name" label="Nombre completo" error={fieldError('name')}>
                <input id="f-name" className="flow-input" autoComplete="name" maxLength={80} value={form.name}
                  onChange={set('name')} onBlur={blur('name')} aria-invalid={!!fieldError('name')}
                  aria-describedby={fieldError('name') ? 'f-name-error' : undefined} />
              </Field>
              <Field id="f-phone" label="WhatsApp" error={fieldError('phone')}
                hint={phone ? 'Número válido.' : 'Celular colombiano de 10 dígitos.'}>
                <input id="f-phone" className="flow-input" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={16}
                  placeholder="300 123 4567" value={form.phone} onChange={set('phone')} onBlur={blur('phone')}
                  aria-invalid={!!fieldError('phone')} aria-describedby={fieldError('phone') ? 'f-phone-error' : undefined} />
              </Field>
              <Field id="f-email" label="Correo (opcional)" error={fieldError('email')}>
                <input id="f-email" className="flow-input" type="email" autoComplete="email" maxLength={254} value={form.email}
                  onChange={set('email')} onBlur={blur('email')} aria-invalid={!!fieldError('email')}
                  aria-describedby={fieldError('email') ? 'f-email-error' : undefined} />
              </Field>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field id="f-city" label="Ciudad" error={fieldError('city')}>
                  <input id="f-city" className="flow-input" autoComplete="address-level2" maxLength={80} value={form.city}
                    onChange={set('city')} onBlur={blur('city')} aria-invalid={!!fieldError('city')}
                    aria-describedby={fieldError('city') ? 'f-city-error' : undefined} />
                </Field>
                <Field id="f-address" label="Dirección" error={fieldError('address')}>
                  <input id="f-address" className="flow-input" autoComplete="street-address" maxLength={200} value={form.address}
                    onChange={set('address')} onBlur={blur('address')} aria-invalid={!!fieldError('address')}
                    aria-describedby={fieldError('address') ? 'f-address-error' : undefined} />
                </Field>
              </div>
              <Field id="f-notes" label="Notas (opcional)" error={fieldError('notes')} hint="Apartamento, barrio o indicaciones para la entrega.">
                <textarea id="f-notes" className="flow-input" rows={3} maxLength={300} value={form.notes} onChange={set('notes')}
                  aria-invalid={!!fieldError('notes')} />
              </Field>

              <fieldset id="f-payment" tabIndex={-1}>
                <legend className="flow-label mb-3">Método de pago</legend>
                <div className="grid gap-2">
                  {methods.map((m) => (
                    <label key={m.value} className="flow-option justify-start">
                      <input type="radio" name="payment_method" value={m.value} checked={form.payment_method === m.value} onChange={set('payment_method')} />
                      {m.label}
                    </label>
                  ))}
                </div>
                {fieldError('payment_method')
                  ? <p className="mt-2 text-xs font-medium text-flow-merlot" role="alert">{fieldError('payment_method')}</p>
                  : <p className="mt-3 text-xs text-flow-muted">{COPY.paymentNote}</p>}
              </fieldset>
            </div>

            <aside className="h-fit border border-flow-stone p-6">
              <h2 className="flow-label mb-4">Resumen</h2>
              <ul className="space-y-3 text-sm">
                {lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className="min-w-0">{l.quantity} × {lineLabel(l)}</span>
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

              {notices}

              <button type="submit" className="flow-btn flow-btn-primary mt-6 w-full">Revisar pedido</button>
              {validating && <p className="mt-2 text-xs text-flow-muted">Revisando la disponibilidad de tu bolsa…</p>}
            </aside>
          </>
        )}

        {step === 'review' && (
          <div className="mx-auto grid max-w-2xl gap-8">
            <section aria-labelledby="r-items">
              <h2 id="r-items" className="flow-label mb-4">Productos</h2>
              <ul className="divide-y divide-[color:var(--flow-sand)] border-y border-[color:var(--flow-sand)] text-sm">
                {lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-4 py-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{l.name}</span>
                      <span className="block text-xs text-flow-muted">
                        {[l.color && `Color: ${l.color}`, l.size && `Talla: ${l.size}`, `Cantidad: ${l.quantity}`].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block text-xs text-flow-muted">Precio unitario: {formatCOP(l.price)}</span>
                    </span>
                    <span className="flex-shrink-0">{formatCOP(l.price * l.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-between text-sm"><span>Subtotal</span><span>{formatCOP(subtotal)}</span></div>
              <div className="mt-2 flex justify-between gap-4 text-sm">
                <span className="min-w-0 break-words">Envío a {form.city.trim()}</span>
                <span className="flex-shrink-0">{shipping === 0 ? 'Gratis' : formatCOP(shipping)}</span>
              </div>
              <hr className="flow-rule my-4" />
              <div className="flex justify-between"><span className="flow-label">Total a pagar</span><span>{formatCOP(subtotal + shipping)}</span></div>
              <p className="mt-3 text-sm">
                <span className="font-medium">Plazo estimado de entrega:</span>{' '}
                {local ? COPY.deliveryLocal : COPY.deliveryNational}.
              </p>
              <p className="mt-1 text-xs text-flow-muted">El total final lo confirma la tienda al recibir tu pedido.</p>
            </section>

            <section aria-labelledby="r-delivery">
              <h2 id="r-delivery" className="flow-label mb-4">Entrega</h2>
              <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
                <dt className="text-flow-muted">Recibe</dt><dd className="break-words">{form.name.trim()}</dd>
                <dt className="text-flow-muted">Teléfono</dt><dd>{phone}</dd>
                <dt className="text-flow-muted">Dirección</dt><dd className="break-words">{form.address.trim()}, {form.city.trim()}</dd>
                {form.notes.trim() && <><dt className="text-flow-muted">Notas</dt><dd className="break-words">{form.notes.trim()}</dd></>}
                {form.email.trim() && <><dt className="text-flow-muted">Correo</dt><dd className="break-all">{form.email.trim()}</dd></>}
                <dt className="text-flow-muted">Método de pago</dt><dd>{methodLabel}</dd>
              </dl>
              <button type="button" onClick={backToForm} className="mt-4 text-sm underline">Corregir mis datos</button>
            </section>

            <section aria-labelledby="r-consents" className="grid gap-4">
              <h2 id="r-consents" className="flow-label">Antes de confirmar</h2>
              <div className="border border-[color:var(--flow-sand)] p-4 text-xs leading-relaxed text-flow-muted" data-testid="privacy-notice">
                <p>{PRIVACY_NOTICE}</p>
              </div>

              <div>
                <label className="flex items-start gap-3 text-sm">
                  <input id="f-terms" type="checkbox" checked={form.terms} onChange={set('terms')} className="mt-1 h-5 w-5 flex-shrink-0 accent-[#1C1C1C]"
                    aria-invalid={!!fieldError('terms')} aria-describedby={fieldError('terms') ? 'f-terms-error' : undefined} />
                  <span>
                    He leído y acepto los{' '}
                    <Link to={path('/terminos')} className="underline" target="_blank">Términos y condiciones de compra</Link>
                    {' '}y la{' '}
                    <Link to={path('/cambios')} className="underline" target="_blank">Política de cambios, retracto, garantía y reversión del pago</Link>.
                  </span>
                </label>
                {consentError('terms', 'f-terms')}
              </div>

              <div>
                <label className="flex items-start gap-3 text-sm">
                  <input id="f-data-auth" type="checkbox" checked={form.dataAuth} onChange={set('dataAuth')} className="mt-1 h-5 w-5 flex-shrink-0 accent-[#1C1C1C]"
                    aria-invalid={!!fieldError('dataAuth')} aria-describedby={fieldError('dataAuth') ? 'f-data-auth-error' : undefined} />
                  <span>
                    Autorizo el tratamiento de mis datos personales para gestionar mi pedido, conforme al{' '}
                    <Link to={path('/privacidad')} className="underline" target="_blank">Aviso de privacidad</Link>
                    {' '}y la{' '}
                    <Link to={path('/privacidad')} className="underline" target="_blank">Política de tratamiento de datos</Link>.
                  </span>
                </label>
                {consentError('dataAuth', 'f-data-auth')}
              </div>

              <fieldset>
                <legend className="text-sm">Quiero recibir novedades y promociones de FLOW por:</legend>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 pl-1 text-sm">
                  <label className="flex items-center gap-3">
                    <input id="f-mkt-whatsapp" type="checkbox" checked={form.marketingWhatsapp} onChange={set('marketingWhatsapp')} className="h-5 w-5 flex-shrink-0 accent-[#1C1C1C]" />
                    WhatsApp
                  </label>
                  <label className="flex items-center gap-3">
                    <input id="f-mkt-email" type="checkbox" checked={form.marketingEmail} onChange={set('marketingEmail')} className="h-5 w-5 flex-shrink-0 accent-[#1C1C1C]"
                      aria-invalid={!!fieldError('marketingEmail')} aria-describedby={fieldError('marketingEmail') ? 'f-mkt-email-error' : undefined} />
                    Correo electrónico
                  </label>
                </div>
                {consentError('marketingEmail', 'f-mkt-email')}
              </fieldset>
            </section>

            {notices}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={backToForm} className="flow-btn flow-btn-outline w-full sm:w-auto">Volver y corregir</button>
              {/* Solo se deshabilita mientras envía, y el texto lo dice */}
              <button type="submit" disabled={submitting} aria-busy={submitting} className="flow-btn flow-btn-primary w-full sm:flex-1">
                {submitting ? 'Enviando…' : 'Confirmar pedido'}
              </button>
            </div>
            {validating && !submitting && <p className="text-xs text-flow-muted">Revisando la disponibilidad de tu bolsa…</p>}
          </div>
        )}
      </form>
    </div>
  );
}
