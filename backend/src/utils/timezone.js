const TIMEZONE_MAP = {
  colombia:   'America/Bogota',
  mexico:     'America/Mexico_City',
  argentina:  'America/Argentina/Buenos_Aires',
  chile:      'America/Santiago',
  peru:       'America/Lima',
  ecuador:    'America/Guayaquil',
};

function getTimezone(country) {
  return TIMEZONE_MAP[(country || '').toLowerCase()] || 'America/Bogota';
}

// Dynamically compute the UTC offset string (e.g. "-05:00") for a given tz,
// accounting for DST at the current moment.
function getOffsetForTz(tz) {
  const now = new Date();
  const tzDate  = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const diffMin = Math.round((tzDate - utcDate) / 60000);
  const sign = diffMin >= 0 ? '+' : '-';
  const abs  = Math.abs(diffMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function getDateByCountry(country) {
  return new Date().toLocaleDateString('en-CA', { timeZone: getTimezone(country) });
}

function getDayRangeByCountry(country) {
  const tz     = getTimezone(country);
  const date   = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const offset = getOffsetForTz(tz);
  return {
    start: `${date}T00:00:00${offset}`,
    end:   `${date}T23:59:59${offset}`,
  };
}

function getMonthRangeByCountry(country) {
  const tz      = getTimezone(country);
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const [year, month] = dateStr.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const offset  = getOffsetForTz(tz);
  const mm      = String(month).padStart(2, '0');
  return {
    start: `${year}-${mm}-01T00:00:00${offset}`,
    end:   `${year}-${mm}-${String(lastDay).padStart(2, '0')}T23:59:59${offset}`,
  };
}

// Convenience: build a day range for a specific YYYY-MM-DD date string + country
function getDayRangeForDate(dateStr, country) {
  const tz     = getTimezone(country);
  const offset = getOffsetForTz(tz);
  return {
    start: `${dateStr}T00:00:00${offset}`,
    end:   `${dateStr}T23:59:59${offset}`,
  };
}

module.exports = { getTimezone, getOffsetForTz, getDateByCountry, getDayRangeByCountry, getMonthRangeByCountry, getDayRangeForDate };
