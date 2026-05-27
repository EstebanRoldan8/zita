const ESCALATION_PHRASE = 'equipo de ZITA';

async function getBotResponse(userMessage, conversationHistory) {
  const msg = userMessage.toLowerCase();

  let message = '¡Hola! Soy el asistente de ZITA. Estoy aquí para ayudarte. ¿En qué te puedo ayudar?';

  if (msg.includes('recordatorio') || msg.includes('recordar')) {
    message = 'Para configurar recordatorios ve a Configuración → Automatizaciones → Recordatorios. Ahí defines cuántas horas antes se envía el mensaje automático.';
  } else if (msg.includes('whatsapp') || msg.includes('conectar')) {
    message = 'Para conectar WhatsApp ve a Configuración → WhatsApp y sigue las instrucciones. Necesitas tener una cuenta de WhatsApp Business.';
  } else if (msg.includes('cita') || msg.includes('agendar')) {
    message = 'Para crear una cita manualmente ve a Citas → Nueva Cita. El chatbot de WhatsApp las crea automáticamente cuando un cliente escribe.';
  } else if (msg.includes('cliente') || msg.includes('contacto')) {
    message = 'Los clientes se registran automáticamente cuando agendan por WhatsApp. También puedes crearlos manualmente en la sección Clientes.';
  } else if (msg.includes('precio') || msg.includes('plan') || msg.includes('pago')) {
    message = 'Para consultas sobre tu plan o pagos, te voy a conectar con el equipo de ZITA.';
  }

  const needsHuman = msg.includes('problema') ||
                     msg.includes('error') ||
                     msg.includes('no funciona') ||
                     msg.includes('hablar con') ||
                     message.includes(ESCALATION_PHRASE);

  return { message, needsHuman };
}

module.exports = { getBotResponse };
