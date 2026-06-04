const { supabaseAdmin } = require('../config/supabase');
const { getPaymentProvider, PLAN_PRICES_COP } = require('../config/payments');
const { generateIntegritySignature, validateWebhookSignature } = require('../services/wompi.service');
const logger = require('../utils/logger');

async function createSession(req, res) {
  try {
    const { plan, payment_method_type } = req.body;
    const businessId = req.businessId;

    if (!PLAN_PRICES_COP[plan]) {
      return res.status(400).json({ success: false, error: 'Plan inválido.' });
    }

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('country')
      .eq('id', businessId)
      .single();

    const country = business?.country || 'colombia';
    const provider = getPaymentProvider(country);
    const amountInCents = PLAN_PRICES_COP[plan];
    const currency = 'COP';
    const reference = `ZITA-${businessId.slice(0, 8)}-${Date.now()}`;
    const integritySignature = generateIntegritySignature(
      reference,
      amountInCents,
      currency,
      provider.integritySecret
    );

    await supabaseAdmin.from('payments').insert({
      business_id: businessId,
      plan,
      amount: amountInCents,
      currency,
      status: 'pending',
      payment_method: payment_method_type || null,
      wompi_reference: reference,
      country,
      provider: provider.provider,
    });

    return res.json({
      success: true,
      data: {
        reference,
        publicKey: provider.publicKey,
        amountInCents,
        currency,
        integritySignature,
        redirectUrl: `${process.env.FRONTEND_URL}/dashboard/suscripcion?ref=${reference}`,
      },
    });
  } catch (err) {
    logger.error('payment.createSession error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al crear sesión de pago.' });
  }
}

async function handleWebhook(req, res) {
  try {
    const signature = req.headers['x-event-checksum'];
    const payload = req.body;
    const event = payload?.event;

    const country = 'colombia';
    const provider = getPaymentProvider(country);

    if (signature && !validateWebhookSignature(payload, signature, provider.eventsSecret)) {
      logger.warn('Wompi webhook: firma inválida');
      return res.status(200).json({ received: true });
    }

    if (event === 'transaction.updated') {
      const tx = payload?.data?.transaction;
      if (!tx) return res.status(200).json({ received: true });

      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('id, business_id, plan')
        .eq('wompi_reference', tx.reference)
        .single();

      if (!payment) return res.status(200).json({ received: true });

      const newStatus = tx.status === 'APPROVED' ? 'approved'
        : tx.status === 'DECLINED' ? 'declined'
        : tx.status === 'VOIDED' ? 'voided'
        : 'error';

      await supabaseAdmin
        .from('payments')
        .update({
          status: newStatus,
          wompi_transaction_id: tx.id,
          payment_method: tx.payment_method?.type || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.id);

      if (newStatus === 'approved') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await supabaseAdmin
          .from('businesses')
          .update({ plan: payment.plan, plan_expires_at: expiresAt.toISOString() })
          .eq('id', payment.business_id);

        logger.info(`Plan activado: business=${payment.business_id} plan=${payment.plan}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('payment.handleWebhook error:', { message: err.message });
    return res.status(200).json({ received: true });
  }
}

async function getHistory(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('id, plan, amount, currency, status, payment_method, wompi_reference, created_at')
      .eq('business_id', req.businessId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('payment.getHistory error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al obtener historial.' });
  }
}

async function getStatus(req, res) {
  try {
    const { reference } = req.params;
    const { data, error } = await supabaseAdmin
      .from('payments')
      .select('id, plan, amount, currency, status, payment_method, wompi_reference, created_at, updated_at')
      .eq('wompi_reference', reference)
      .eq('business_id', req.businessId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Pago no encontrado.' });
    }
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('payment.getStatus error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al consultar pago.' });
  }
}

async function adminGeneratePaymentLink(req, res) {
  try {
    const { id } = req.params;
    const { plan } = req.body;

    if (!PLAN_PRICES_COP[plan]) {
      return res.status(400).json({ success: false, error: 'Plan inválido.' });
    }

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('country')
      .eq('id', id)
      .single();

    const country = business?.country || 'colombia';
    const provider = getPaymentProvider(country);
    const amountInCents = PLAN_PRICES_COP[plan];
    const currency = 'COP';
    const reference = `ZITA-${id.slice(0, 8)}-${Date.now()}`;
    const integritySignature = generateIntegritySignature(reference, amountInCents, currency, provider.integritySecret);

    await supabaseAdmin.from('payments').insert({
      business_id: id,
      plan,
      amount: amountInCents,
      currency,
      status: 'pending',
      wompi_reference: reference,
      country,
      provider: provider.provider,
    });

    const checkoutUrl =
      `https://checkout.wompi.co/p/?` +
      `public-key=${provider.publicKey}` +
      `&currency=${currency}` +
      `&amount-in-cents=${amountInCents}` +
      `&reference=${reference}` +
      `&signature:integrity=${integritySignature}`;

    return res.json({ success: true, data: { checkoutUrl, reference, amountInCents, currency } });
  } catch (err) {
    logger.error('payment.adminGeneratePaymentLink error:', { message: err.message });
    return res.status(500).json({ success: false, error: 'Error al generar link de pago.' });
  }
}

module.exports = { createSession, handleWebhook, getHistory, getStatus, adminGeneratePaymentLink };
