// Los rechazos de multer (tipo inválido, más de 2 MB, demasiados archivos) responden 400 con un mensaje claro
// en vez de llegar al manejador global como 500. Como multer usa memoria, ningún archivo llega a Storage.
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'Cada imagen debe pesar máximo 2 MB.',
  LIMIT_UNEXPECTED_FILE: 'Máximo 8 imágenes por petición, en el campo "images".',
  LIMIT_FILE_COUNT: 'Máximo 8 imágenes por petición.',
};

// Envuelve un middleware de multer (p. ej. upload.single('image')): si falla, responde 400
function handleUploadErrors(multerMiddleware, messages = MULTER_MESSAGES) {
  return (req, res, next) => multerMiddleware(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ success: false, error: messages[err.code] || err.message || 'Archivos inválidos.' });
  });
}

module.exports = { handleUploadErrors, MULTER_MESSAGES };
