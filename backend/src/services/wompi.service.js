const axios = require('axios');
const crypto = require('crypto');
const { getPaymentProvider } = require('../config/payments');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const PERIOD_DAYS = {
  monthly: 30,
  biannual: 180,
  annual: 365
};

const NETWORK_ERROR_CODES = ['ECONNABORTED', 'ECONNREFUSED', 'ENETUNREACH'];
const MAX_RETRIES = 2;

async function createTransaction(businessId, plan, amountInCents, currency, reference, country) {
  const provider = getPaymentProvider(country);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
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
          timeout: 10000,
        }
      );
      return response.data;
    } catch (error) {
      const isNetworkError = NETWORK_ERROR_CODES.includes(error.code);
      const retriesLeft = MAX_RETRIES - attempt;

      if (!isNetworkError || retriesLeft <= 0) {
        throw error;
      }

      const retryNumber = attempt + 1;
      logger.warn(`[WOMPI] Retry ${retryNumber}/${MAX_RETRIES} para transaction creation: ${error.code}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * retryNumber));
    }
  }
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
  // Payload malformado — rechaza sin intentar validar
  if (!payload.event || !payload.data?.transaction) {
    return false;
  }

  const properties = [
    payload.data.transaction.id,
    payload.data.transaction.status,
    payload.data.transaction.amount_in_cents,
    payload.timestamp,
    eventsSecret,
  ];

  const raw = properties.join('');
  const expected = crypto.createHash('sha256').update(raw).digest('hex');
  return expected === signature;
}

// Lógica compartida de extensión de plan, usada tanto por el webhook normal
// como por la reconciliación batch, para evitar divergencia entre ambos caminos.
async function activatePlanExtension(paymentId) {
  const { data: payment, error: paymentError } = await supabaseAdmin
    .from('payments')
    .select('id, business_id, plan, period')
    .eq('id', paymentId)
    .single();

  if (paymentError || !payment) {
    logger.error('[WOMPI] activatePlanExtension: payment no encontrado', {
      paymentId,
      error: paymentError?.message
    });
    return;
  }

  const { data: business } = await supabaseAdmin
    .from('businesses')
    .select('plan_expires_at')
    .eq('id', payment.business_id)
    .single();

  const period = payment.period || 'monthly';
  const days = PERIOD_DAYS[period] || 30;
  const baseDate = business?.plan_expires_at && new Date(business.plan_expires_at) > new Date()
    ? new Date(business.plan_expires_at)
    : new Date();

  const expiresAt = new Date(baseDate);
  expiresAt.setDate(expiresAt.getDate() + days);

  await supabaseAdmin
    .from('businesses')
    .update({ plan: payment.plan, plan_expires_at: expiresAt.toISOString() })
    .eq('id', payment.business_id);

  await supabaseAdmin
    .from('scheduled_downgrades')
    .delete()
    .eq('business_id', payment.business_id);

  logger.info(`Plan activado: business=${payment.business_id} plan=${payment.plan} period=${period}`);
}

// Reconciliación batch: detecta payments 'pending' que Wompi ya resolvió pero
// cuyo webhook nunca llegó (o llegó y falló). No está conectada a cron —
// se dispara manualmente vía POST /api/internal/reconcile-wompi-payments.
async function reconcileWompiPayments() {
  const startTime = Date.now();
  console.log('[WOMPI_RECONCILIATION_JOB_START] Iniciando reconciliación de pagos...');

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: pendingPayments, error } = await supabaseAdmin
    .from('payments')
    .select('id, business_id, status, wompi_transaction_id, country, created_at')
    .eq('status', 'pending')
    .lt('created_at', oneHourAgo);

  if (error) {
    logger.error('[WOMPI_RECONCILIATION] Error al obtener payments pendientes', { error: error.message });
    const summary = {
      totalPendingReviewed: 0,
      discrepanciesFound: 0,
      corrected: 0,
      duration_ms: Date.now() - startTime
    };
    console.log('[WOMPI_RECONCILIATION_JOB_COMPLETE]', JSON.stringify(summary));
    return { checked: 0, corrected: 0, discrepancies: [], errors: [error.message] };
  }

  const result = { checked: 0, corrected: 0, discrepancies: [], errors: [] };

  for (const payment of pendingPayments || []) {
    if (!payment.wompi_transaction_id) continue; // aún no hay transaction_id que consultar

    result.checked++;

    try {
      const wompiData = await getTransaction(payment.wompi_transaction_id, payment.country || 'colombia');
      const wompiStatus = wompiData?.data?.status;

      if (wompiStatus === 'APPROVED') {
        const { error: updateError } = await supabaseAdmin
          .from('payments')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('id', payment.id)
          .eq('business_id', payment.business_id)
          .eq('status', 'pending'); // evita pisar un cambio hecho por el webhook en paralelo

        if (updateError) {
          result.errors.push(`payment ${payment.id}: ${updateError.message}`);
          logger.error('[WOMPI_RECONCILIATION] Error al actualizar payment', {
            paymentId: payment.id,
            error: updateError.message
          });
          continue;
        }

        await activatePlanExtension(payment.id);
        result.corrected++;
        logger.info(`[WOMPI_RECONCILIATION] Payment ${payment.id} corrected: was pending, Wompi confirmed as approved`);
      } else if (wompiStatus && wompiStatus !== 'PENDING') {
        result.discrepancies.push({ paymentId: payment.id, zitaStatus: payment.status, wompiStatus });
        logger.warn(`[WOMPI_RECONCILIATION] Discrepancia: payment ${payment.id} ZITA=pending Wompi=${wompiStatus}`);
      }
    } catch (err) {
      result.errors.push(`payment ${payment.id}: ${err.message}`);
      logger.error('[WOMPI_RECONCILIATION] Error consultando Wompi', {
        paymentId: payment.id,
        error: err.message
      });
    }
  }

  const summary = {
    totalPendingReviewed: result.checked,
    discrepanciesFound: result.discrepancies.length,
    corrected: result.corrected,
    duration_ms: Date.now() - startTime
  };
  console.log('[WOMPI_RECONCILIATION_JOB_COMPLETE]', JSON.stringify(summary));

  return result;
}

module.exports = {
  createTransaction,
  getTransaction,
  generateIntegritySignature,
  validateWebhookSignature,
  activatePlanExtension,
  reconcileWompiPayments,
  PERIOD_DAYS,
};
