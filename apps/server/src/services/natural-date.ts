import { addDays, addMonths, type DateStr } from '@homestead/shared';

/**
 * Parses the date out of a quick-add phrase (TASK-001). Deliberately small:
 * it handles what people actually type at a capture box and leaves the rest of
 * the text as the title, rather than guessing and silently mis-scheduling.
 */
export interface ParsedQuickAdd {
  title: string;
  dueDate: DateStr | null;
  dueTime: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  matched: string | null;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

function dayOfWeek(d: DateStr): number {
  return new Date(d + 'T00:00:00Z').getUTCDay();
}

function nextWeekday(from: DateStr, target: number, forceNextWeek: boolean): DateStr {
  const cur = dayOfWeek(from);
  let delta = (target - cur + 7) % 7;
  if (delta === 0) delta = 7;
  if (forceNextWeek && delta < 7) delta += 7 - ((delta - 1) % 7) - 1;
  return addDays(from, forceNextWeek ? (delta <= 7 ? delta + 0 : delta) : delta);
}

function parseTime(raw: string): string | null {
  const m = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toLowerCase();
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function parseNaturalDue(input: string, today: DateStr): ParsedQuickAdd {
  let text = input.trim();
  let dueDate: DateStr | null = null;
  let matched: string | null = null;
  let priority: ParsedQuickAdd['priority'] = null;

  const prio = text.match(/(^|\s)!(low|normal|high|urgent)\b/i);
  if (prio) {
    priority = prio[2]!.toLowerCase() as ParsedQuickAdd['priority'];
    text = text.replace(prio[0], ' ').trim();
  }

  const patterns: Array<[RegExp, (m: RegExpMatchArray) => DateStr | null]> = [
    [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => m[1]!],
    [/\btoday\b/i, () => today],
    [/\btomorrow\b|\btmw\b/i, () => addDays(today, 1)],
    [/\byesterday\b/i, () => addDays(today, -1)],
    [/\bin (\d+) (day|days|week|weeks|month|months)\b/i, (m) => {
      const n = Number(m[1]);
      const unit = m[2]!.toLowerCase();
      if (unit.startsWith('day')) return addDays(today, n);
      if (unit.startsWith('week')) return addDays(today, n * 7);
      return addMonths(today, n);
    }],
    [/\bnext (week|month|year)\b/i, (m) => {
      const u = m[1]!.toLowerCase();
      return u === 'week' ? addDays(today, 7) : u === 'month' ? addMonths(today, 1) : addMonths(today, 12);
    }],
    [/\b(next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
      (m) => {
        const target = WEEKDAYS[m[2]!.toLowerCase()];
        if (target == null) return null;
        return nextWeekday(today, target, false);
      }],
  ];

  for (const [re, fn] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const d = fn(m);
    if (!d) continue;
    dueDate = d;
    matched = m[0];
    text = text.replace(m[0], ' ').trim();
    break;
  }

  const dueTime = parseTime(input);
  if (dueTime) {
    const timeMatch = input.match(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i) ?? input.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (timeMatch) text = text.replace(timeMatch[0], ' ').trim();
  }

  const title = text.replace(/\s{2,}/g, ' ').replace(/^(at|on|by|due)\s+/i, '').trim();
  return {
    title: title || input.trim(),
    dueDate,
    dueTime,
    priority,
    matched,
  };
}
