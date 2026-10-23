// the site's calendar: a day runs midnight to midnight in Ontario, whoever is looking,
// so the daily totals in D1 never have to be redone for another timezone.

export const TZ = 'America/Toronto';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
});

function parts(ms) {
  const p = {};
  for (const x of fmt.formatToParts(ms)) p[x.type] = Number(x.value);
  return p;
}

// YYYY-MM-DD in Ontario
export function localDay(ms) {
  const p = parts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Ontario minus UTC, in ms (-4 or -5 hours)
export function offsetAt(ms) {
  const p = parts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - (ms - (ms % 60000));
}

// the instant a local day starts, in ms
export function dayStart(day) {
  const [y, m, d] = day.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  return utc - offsetAt(utc - offsetAt(utc));
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const iso = (ms) => new Date(ms).toISOString();
