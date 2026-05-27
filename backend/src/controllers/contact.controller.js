const { supabaseAdmin } = require('../config/supabase');
const resend = require('../config/resend');
const { Anthropic } = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const createContactRequest = async (req, res) => {
  try {
    const { nombre, tipo_negocio, ciudad, whatsapp, email, mensaje, servicio } = req.body;

    logger.info('Contact request received:', { nombre, tipo_negocio, ciudad, whatsapp, email, servicio });

    if (!nombre || !ciudad || !whatsapp || !mensaje) {
      logger.warn('Missing required fields:', { nombre, ciudad, whatsapp, mensaje });
      return res.status(400).json({ error: 'Campos requeridos: nombre, ciudad, whatsapp, mensaje' });
    }

    const { data: contact, error } = await supabaseAdmin
      .from('contact_requests')
      .insert({
        nombre,
        tipo_negocio,
        ciudad,
        whatsapp,
        email,
        mensaje,
        servicio: servicio || 'general',
        status: 'pending',
      })
      .select();

    if (error) {
      logger.error('Error guardando solicitud de contacto:', { error: error.message, details: error });
      return res.status(500).json({ error: 'Error al procesar la solicitud', details: error.message });
    }

    logger.info('Contacto guardado en DB:', { id: contact[0]?.id });

    try {
      await resend.emails.send({
        from: 'ZITA <onboarding@resend.dev>',
        to: 'esteban.zita.ia@gmail.com',
        subject: `Nueva solicitud de contacto — ${nombre}`,
        html: `
          <h2>Nueva solicitud de contacto en ZITA</h2>
          <p><b>Nombre:</b> ${nombre}</p>
          <p><b>Tipo de negocio:</b> ${tipo_negocio || 'No especificado'}</p>
          <p><b>Ciudad:</b> ${ciudad}</p>
          <p><b>WhatsApp:</b> ${whatsapp}</p>
          <p><b>Email:</b> ${email || 'No proporcionado'}</p>
          <p><b>Servicio de interés:</b> ${servicio || 'general'}</p>
          <p><b>Mensaje:</b> ${mensaje}</p>
          <p><small>Recibido el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</small></p>
        `,
      });
      logger.info('Email enviado correctamente');
    } catch (emailError) {
      logger.error('Error enviando email:', emailError);
    }

    try {
      await supabaseAdmin.from('notifications').insert({
        type: 'contact_request',
        message: `Nueva solicitud de ${nombre} — ${tipo_negocio || 'Indefinido'} en ${ciudad}`,
        metadata: { nombre, tipo_negocio, ciudad, whatsapp, servicio },
      });
      logger.info('Notificación creada');
    } catch (notifError) {
      logger.error('Error creando notificación:', notifError);
    }

    logger.info(`Solicitud completada de ${nombre}`);
    res.status(200).json({ success: true, message: 'Solicitud recibida' });
  } catch (error) {
    logger.error('Error en createContactRequest:', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
};

const demoMessage = async (req, res) => {
  try {
    const { message, negocio = 'barberia' } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }

    const serviciosPorTipo = {
      barberia: 'Corte clásico $25k, Degradado $28k, Corte+barba $40k, Arreglo barba $15k',
      spa: 'Masaje relajante $80k, Facial $60k, Manicure $45k, Pedicure $50k',
      veterinaria: 'Consulta general $50k, Vacunación $35k, Baño y corte $40k, Desparasitación $25k',
      dentista: 'Limpieza dental $80k, Blanqueamiento $200k, Consulta $60k, Extracción $90k',
      tienda: 'Camiseta $45k, Pantalón $80k, Zapatos $120k, Accesorios $25k',
      gimnasio: 'Mensualidad $120k, Clase personal $50k, Evaluación física $30k',
    };

    const tipo = negocio || 'barberia';
    const servicios = serviciosPorTipo[tipo] || serviciosPorTipo.barberia;

    const systemPrompt = `Eres el bot de WhatsApp de una ${tipo}.
Servicios disponibles: ${servicios}.
Simula que puedes agendar citas para estos servicios.
Responde en español colombiano informal.
Máximo 3 líneas por respuesta.
Sé amigable y directo como el bot real de ZITA.
No menciones que eres una demo.`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const botMessage = response.content[0].type === 'text' ? response.content[0].text : 'Error procesando mensaje';

    res.status(200).json({ response: botMessage });
  } catch (error) {
    logger.error('Error en demoMessage:', error);
    res.status(500).json({ error: 'Error procesando mensaje' });
  }
};

module.exports = {
  createContactRequest,
  demoMessage,
};
