function superadminOnly(req, res, next) {
  if (req.user?.email !== process.env.SUPERADMIN_EMAIL) {
    return res.status(403).json({ success: false, error: 'Acceso denegado' });
  }
  next();
}

module.exports = { superadminOnly };
