// Métodos de pago que el checkout de la tienda puede ofrecer. Ninguno se paga en el sitio: el pedido se
// crea y los datos de pago se envían por WhatsApp. Se habilitan POR NEGOCIO en
// businesses.store_settings.checkout_payment_methods (lista, p. ej. ['transferencia', 'nequi']).
// (payment_methods, el texto de la tienda, es solo informativo: se muestra en el pie de página.)
// Sin la clave, o con una lista sin métodos válidos, el negocio ofrece solo 'transferencia'.
const KNOWN_PAYMENT_METHODS = ['transferencia', 'nequi'];
const DEFAULT_PAYMENT_METHODS = ['transferencia'];

function enabledPaymentMethods(settings) {
  const raw = settings && Array.isArray(settings.checkout_payment_methods) ? settings.checkout_payment_methods : [];
  const valid = [...new Set(raw.map((m) => String(m ?? '').trim().toLowerCase()).filter((m) => KNOWN_PAYMENT_METHODS.includes(m)))];
  return valid.length > 0 ? valid : [...DEFAULT_PAYMENT_METHODS];
}

module.exports = { KNOWN_PAYMENT_METHODS, DEFAULT_PAYMENT_METHODS, enabledPaymentMethods };
