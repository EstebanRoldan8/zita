const PAYMENT_PROVIDERS = {
  colombia: {
    provider: 'wompi',
    publicKey: process.env.WOMPI_PUBLIC_KEY_CO,
    privateKey: process.env.WOMPI_PRIVATE_KEY_CO,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET_CO,
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET_CO,
    // ISSUE #11: sin default. Verificado en Railway (proyecto "courageous-art",
    // servicio "zita", producción) que WOMPI_API_URL está seteada a
    // https://production.wompi.co/v1. Un default hardcodeado a sandbox es
    // peligroso (fallaría en modo silencioso apuntando al ambiente equivocado);
    // preferimos que falle explícito si la env var falta.
    apiUrl: process.env.WOMPI_API_URL,
  },
  mexico: {
    provider: 'mercadopago',
    // Se configurará cuando se implemente
  },
};

function getPaymentProvider(country) {
  const normalized = (country || 'colombia').toLowerCase();
  const provider = PAYMENT_PROVIDERS[normalized] || PAYMENT_PROVIDERS.colombia;

  if (provider.provider === 'wompi' && !provider.apiUrl) {
    throw new Error('WOMPI_API_URL no está configurada. Debe setearse explícitamente (producción: https://production.wompi.co/v1) — no hay default por seguridad.');
  }

  return provider;
}

const PLAN_PRICES_COP = {
  lite: 6000000,      // $60.000 COP en centavos
  estandar: 10000000, // $100.000 COP en centavos
  pro: 15000000,      // $150.000 COP en centavos
};

module.exports = { getPaymentProvider, PLAN_PRICES_COP };
