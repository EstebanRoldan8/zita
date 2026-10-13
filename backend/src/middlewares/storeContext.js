const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

// slug: minúsculas, números y guiones; sin comodines de LIKE
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

const notFound = (res) => res.status(404).json({ success: false, error: 'Tienda no encontrada.' });

// Rutas públicas de la tienda: el negocio sale SOLO del slug de la URL, nunca del body ni de headers.
// Si el slug no existe o la tienda no está activa, 404 genérico (no revela si el negocio existe).
async function storeContext(req, res, next) {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) return notFound(res);

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .select('id, name, slug, store_settings, owner_whatsapp, whatsapp_phone_number_id, whatsapp_access_token')
      .ilike('slug', slug)
      .eq('store_enabled', true)
      .maybeSingle();
    if (error || !data) return notFound(res);

    req.storeBusinessId = data.id;
    req.storeBusiness = { id: data.id, name: data.name, slug: data.slug, settings: data.store_settings || {} };
    // Solo para notificar al dueño; nunca se devuelve en una respuesta
    req.storeOwnerContact = {
      owner_whatsapp: data.owner_whatsapp,
      whatsapp_phone_number_id: data.whatsapp_phone_number_id,
      whatsapp_access_token: data.whatsapp_access_token,
    };
    next();
  } catch (err) {
    logger.error('storeContext: ' + err.message);
    return notFound(res);
  }
}

module.exports = { storeContext };
