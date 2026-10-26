const { body, validationResult } = require('express-validator');

const validateRegister = [
  body('email')
    .isEmail().withMessage('El email no es válido.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres.'),
  body('name')
    .notEmpty().withMessage('El nombre es obligatorio.')
    .isLength({ max: 100 }).withMessage('El nombre no puede superar los 100 caracteres.')
    .trim(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }
    next();
  },
];

// ── Pedido de la tienda pública (POST /api/store/:slug/orders) ──────────────
// Mismo patrón que validateRegister. Los precios y totales NO se validan aquí:
// el servidor los calcula desde la base y cualquier precio del body se ignora.
const { normalizeColombianPhone } = require('../utils/phone');

const STORE_PAYMENT_METHODS = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'wompi', 'otro'];
// Quita caracteres de control y < > para que ningún texto llegue con marcado
const cleanText = (v) => String(v ?? '').replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim();

const validateStoreOrder = [
  body('items')
    .isArray({ min: 1, max: 20 }).withMessage('El pedido debe tener entre 1 y 20 artículos.'),
  body('items.*.product_id')
    .isUUID().withMessage('Producto inválido.'),
  body('items.*.variant_id')
    .optional({ values: 'null' })
    .isUUID().withMessage('Variante inválida.'),
  body('items.*.quantity')
    .isInt({ min: 1, max: 10 }).withMessage('La cantidad de cada artículo debe ser un número entero entre 1 y 10.')
    .toInt(),
  body('customer.name')
    .customSanitizer(cleanText)
    .isLength({ min: 2, max: 80 }).withMessage('El nombre debe tener entre 2 y 80 caracteres.'),
  body('customer.phone')
    .customSanitizer((v) => normalizeColombianPhone(v))
    .custom((v) => v !== null).withMessage('El teléfono debe ser un celular colombiano de 10 dígitos.'),
  body('customer.email')
    .optional({ values: 'falsy' })
    .customSanitizer((v) => cleanText(v).toLowerCase())
    .isLength({ max: 254 }).withMessage('El correo no es válido.')
    .isEmail().withMessage('El correo no es válido.'),
  body('shipping.address')
    .customSanitizer(cleanText)
    .isLength({ min: 5, max: 200 }).withMessage('La dirección debe tener entre 5 y 200 caracteres.'),
  body('shipping.city')
    .customSanitizer(cleanText)
    .isLength({ min: 2, max: 80 }).withMessage('La ciudad debe tener entre 2 y 80 caracteres.'),
  body('shipping.notes')
    .optional({ values: 'falsy' })
    .customSanitizer(cleanText)
    .isLength({ max: 300 }).withMessage('Las notas no pueden superar 300 caracteres.'),
  body('payment_method')
    .customSanitizer((v) => cleanText(v).toLowerCase())
    .isIn(STORE_PAYMENT_METHODS).withMessage(`Método de pago inválido. Usa: ${STORE_PAYMENT_METHODS.join(', ')}.`),
  // Casillas del checkout (Anexo 1.2): términos y autorización de datos son obligatorias (true estricto);
  // las de marketing son opcionales. La fecha y la versión las pone el servidor, no el cliente.
  body('consents.terms')
    .custom((v) => v === true).withMessage('Debes aceptar los Términos y condiciones y la Política de cambios para continuar.'),
  body('consents.data_auth')
    .custom((v) => v === true).withMessage('Debes autorizar el tratamiento de tus datos personales para continuar.'),
  body('consents.marketing_whatsapp').optional({ values: 'null' }).isBoolean({ strict: true }).withMessage('Preferencia de WhatsApp inválida.'),
  body('consents.marketing_email').optional({ values: 'null' }).isBoolean({ strict: true }).withMessage('Preferencia de correo inválida.'),
  body('idempotency_key')
    .customSanitizer((v) => String(v ?? '').trim())
    .matches(/^[A-Za-z0-9_-]{8,100}$/).withMessage('Falta la clave de idempotencia del pedido.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const first = errors.array()[0];
      return res.status(400).json({ success: false, error: first.msg, field: first.path });
    }
    next();
  },
];

module.exports = { validateRegister, validateStoreOrder, STORE_PAYMENT_METHODS };
