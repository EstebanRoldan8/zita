const axios = require('axios');
const crypto = require('crypto');
const { getPaymentProvider } = require('../config/payments');

async function createTransaction(businessId, plan, amountInCents, currency, reference, country) {
  const provider = getPaymentProvider(country);
  const response = await axios.post(
    `${provider.apiUrl}/transactions`,
    {
      amount_in_cents: amountInCents,
      currency,
      customer_email: null,
      reference,
      payment_method: { type: 'CARD' },
    },
    {
      headers: {
        Authorization: `Bearer ${provider.privateKey}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

async function getTransaction(transactionId, country) {
  const provider = getPaymentProvider(country);
  const response = await axios.get(
    `${provider.apiUrl}/transactions/${transactionId}`,
    {
      headers: { Authorization: `Bearer ${provider.privateKey}` },
    }
  );
  return response.data;
}

function generateIntegritySignature(reference, amountInCents, currency, integritySecret) {
  const raw = `${reference}${amountInCents}${currency}${integritySecret}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function validateWebhookSignature(payload, signature, eventsSecret) {
  const properties = payload.event
    ? [
        payload.data?.transaction?.id,
        payload.data?.transaction?.status,
        payload.data?.transaction?.amount_in_cents,
        payload.timestamp,
        eventsSecret,
      ]
    : [];

  const raw = properties.join('');
  const expected = crypto.createHash('sha256').update(raw).digest('hex');
  return expected === signature;
}

module.exports = {
  createTransaction,
  getTransaction,
  generateIntegritySignature,
  validateWebhookSignature,
};
