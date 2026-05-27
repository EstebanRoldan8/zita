const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

async function getConfig(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    const { data, error } = await userClient
      .from('loyalty_config')
      .select('id, visits_for_reward, reward_service_id, points_per_appointment, points_per_product, rewards_description')
      .eq('business_id', req.businessId)
      .maybeSingle();

    if (error) throw error;
    return res.json({ success: true, data: data || null });
  } catch (err) {
    logger.error(`loyalty.getConfig: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateConfig(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { visits_for_reward, reward_service_id } = req.body;

    if (visits_for_reward !== undefined && (isNaN(visits_for_reward) || visits_for_reward <= 0)) {
      return res.status(400).json({ success: false, error: 'visits_for_reward debe ser un número positivo.' });
    }

    const { data, error } = await userClient
      .from('loyalty_config')
      .upsert(
        {
          business_id: req.businessId,
          visits_for_reward: visits_for_reward || 10,
          reward_service_id: reward_service_id || null,
        },
        { onConflict: 'business_id' }
      )
      .select()
      .single();

    if (error) {
      logger.error(`loyalty.updateConfig - Supabase error code: ${error.code}, message: ${error.message}, details: ${JSON.stringify(error.details)}`);
      throw error;
    }
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`loyalty.updateConfig: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al actualizar la configuración de fidelización.' });
  }
}

async function redeem(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId es requerido.' });
    }

    const now = new Date().toISOString();

    // Verificar si existe el registro
    const { data: existing, error: checkError } = await userClient
      .from('client_loyalty')
      .select('id')
      .eq('business_id', req.businessId)
      .eq('client_id', clientId)
      .single();

    let data, error;

    if (existing) {
      // Si existe → update (resetear solo loyalty_visits, no total_visits)
      const result = await userClient
        .from('client_loyalty')
        .update({ loyalty_visits: 0, last_redeemed_at: now })
        .eq('business_id', req.businessId)
        .eq('client_id', clientId)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Si no existe → insert
      const result = await userClient
        .from('client_loyalty')
        .insert({
          business_id: req.businessId,
          client_id: clientId,
          loyalty_visits: 0,
          total_visits: 0,
          last_redeemed_at: now,
        })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      logger.error(`loyalty.redeem - Supabase error code: ${error.code}, message: ${error.message}, details: ${JSON.stringify(error.details)}`);
      throw error;
    }

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`loyalty.redeem: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al canjear la recompensa.' });
  }
}

module.exports = {
  getConfig,
  updateConfig,
  redeem,
};
