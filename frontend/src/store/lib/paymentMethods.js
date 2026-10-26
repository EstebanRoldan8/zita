// Métodos de pago del checkout. Ninguno se paga en el sitio: el pedido se crea y los datos de pago llegan por
// WhatsApp. La tienda decide cuáles ofrece (store.checkout_payment_methods, lo valida el servidor);
// si no define ninguno, solo transferencia. Aquí no hay cuentas, llaves ni números de pago.
export const PAYMENT_OPTIONS = {
  transferencia: {
    value: 'transferencia',
    label: 'Transferencia / llave',
    short: 'transferencia',
    text: 'Pago por transferencia bancaria (Bancolombia) o llave. Te enviamos los datos de pago por WhatsApp.',
  },
  nequi: {
    value: 'nequi',
    label: 'Nequi',
    short: 'Nequi',
    text: 'Pago por Nequi. Te enviamos los datos por WhatsApp.',
  },
};

export function methodsFor(store) {
  const list = Array.isArray(store?.checkout_payment_methods) ? store.checkout_payment_methods : [];
  const options = list.map((m) => PAYMENT_OPTIONS[m]).filter(Boolean);
  return options.length > 0 ? options : [PAYMENT_OPTIONS.transferencia];
}

export const paymentLabel = (method) => PAYMENT_OPTIONS[method]?.label || '';
export const paymentShort = (method) => PAYMENT_OPTIONS[method]?.short || '';
