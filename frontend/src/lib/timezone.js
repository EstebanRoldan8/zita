const TIMEZONE_MAP = {
  colombia: 'America/Bogota',
  mexico: 'America/Mexico_City',
  argentina: 'America/Argentina/Buenos_Aires',
  chile: 'America/Santiago',
  peru: 'America/Lima',
  ecuador: 'America/Guayaquil',
};

export function getTimezone(country) {
  return TIMEZONE_MAP[(country || '').toLowerCase()] || 'America/Bogota';
}

export function timeFromISO(iso, country) {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat('es-CO', {
    timeZone: getTimezone(country),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}
