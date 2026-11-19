// Escalaciones del bot (GET /api/escalations): helpers puros para el panel del dueño (probados en tests/escalations.test.js).

// "hace 5 min", "hace 2 h", "hace 3 días" (o "recién" si es de hace menos de un minuto)
export function timeAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

// Sin atender primero; dentro de cada grupo, las más recientes primero
export function sortEscalations(items) {
  return [...(items || [])].sort((a, b) => {
    if (!!a.attended_at !== !!b.attended_at) return a.attended_at ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// Teléfono para mostrar: el completo si lo hay, si no el enmascarado guardado
export function displayPhone(item) {
  const p = item?.client_phone || item?.client_phone_masked || '';
  return p ? `+${String(p).replace(/^\+/, '')}` : '';
}
