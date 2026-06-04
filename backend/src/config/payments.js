const PAYMENT_PROVIDERS = {
  colombia: {
    provider: 'wompi',
    publicKey: process.env.WOMPI_PUBLIC_KEY_CO,
    privateKey: process.env.WOMPI_PRIVATE_KEY_CO,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET_CO,
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET_CO,
    apiUrl: process.env.WOMPI_API_URL || 'https://sandbox.wompi.co/v1',
  },
  mexico: {
    provider: 'mercadopago',
    // Se configurará cuando se implemente
  },
};

function getPaymentProvider(country) {
  const normalized = (country || 'colombia').toLowerCase();
  return PAYMENT_PROVIDERS[normalized] || PAYMENT_PROVIDERS.colombia;
}

const PLAN_PRICES_COP = {
  lite: 6000000,      // $60.000 COP en centavos
  estandar: 10000000, // $100.000 COP en centavos
  pro: 15000000,      // $150.000 COP en centavos
};

module.exports = { getPaymentProvider, PLAN_PRICES_COP };
