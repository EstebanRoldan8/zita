const PLANS = {
  lite: {
    name: 'Lite',
    price: 60000,
    max_employees: 2,
    max_appointments_month: 300,
    max_orders_month: 100,
    ai_messages_day: 0,
    features: ['bot_whatsapp', 'citas', 'empleados']
  },
  estandar: {
    name: 'Estándar',
    price: 100000,
    max_employees: 5,
    max_appointments_month: 700,
    max_orders_month: 300,
    ai_messages_day: 30,
    features: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'clientes', 'productos', 'analiticas', 'configuracion', 'asistente_ia']
  },
  pro: {
    name: 'Pro',
    price: 150000,
    max_employees: -1,
    max_appointments_month: -1,
    max_orders_month: -1,
    ai_messages_day: 500,
    features: ['bot_whatsapp', 'citas', 'empleados', 'caja', 'clientes', 'productos', 'analiticas', 'configuracion', 'asistente_ia', 'campanas', 'reportes_pdf', 'multi_sede']
  }
};

const GRACE_DAYS = 3;

module.exports = { PLANS, GRACE_DAYS };
