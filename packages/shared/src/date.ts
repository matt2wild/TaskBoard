/** Calendar-date and timezone helpers. Household scheduling works on wall-clock
 *  dates; instants are only computed when a reminder needs firing. */

export type DateStr = string; // YYYY-MM-DD
export type TimeStr = string; // HH:MM (24h)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateStr(s: unknown): s is DateStr {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}
export function isTimeStr(s: unknown): s is TimeStr {
  return typeof s === 'string' && TIME_RE.test(s);
}

/** Days since epoch for a calendar date, using UTC noon to stay clear of DST. */
export function toEpochDay(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}
export function fromEpochDay(n: number): DateStr {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
export function addDays(d: DateStr, n: number): DateStr {
  return fromEpochDay(toEpochDay(d) + n);
}
export function diffDays(a: DateStr, b: DateStr): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** Add months, clamping to the end of the target month (Jan 31 + 1mo = Feb 28/29). */
export function addMonths(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const total = (y * 12) + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(day, last);
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
export function addYears(d: DateStr, n: number): DateStr {
  return addMonths(d, n * 12);
}

export function todayInZone(tz: string, now: Date = new Date()): DateStr {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Offset in minutes of `tz` at the given instant (positive east of UTC). */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  let hour = get('hour');
  if (hour === 24) hour = 0; // some ICU builds render midnight as 24
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock date+time in `tz` to the UTC instant it denotes.
 *  Handles DST by solving the offset fixpoint; for a skipped local time the
 *  result lands on the next valid instant, for an ambiguous one on the first. */
export function zonedToUtc(date: DateStr, time: TimeStr, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = new Date(naive);
  for (let i = 0; i < 3; i++) {
    const off = zoneOffsetMinutes(tz, guess);
    const next = new Date(naive - off * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

export function startOfMonth(d: DateStr): DateStr { return d.slice(0, 8) + '01'; }
export function endOfMonth(d: DateStr): DateStr {
  const [y, m] = d.split('-').map(Number) as [number, number];
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}
/** Season of a date in the northern hemisphere, used for seasonal grouping. */
export function seasonOf(d: DateStr): 'winter' | 'spring' | 'summer' | 'fall' {
  const m = Number(d.slice(5, 7));
  if (m <= 2 || m === 12) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'fall';
}
