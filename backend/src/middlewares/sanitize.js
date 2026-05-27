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

module.exports = { validateRegister };
