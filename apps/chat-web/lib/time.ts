const TZ = 'Asia/Jakarta';

const timeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'short' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function ymd(d: Date) {
  return ymdFmt.format(d);
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return timeFmt.format(d).replace('.', ':');
}

/** Short time for lists: HH:mm today, weekday within a week, else d MMM. */
export function fmtListTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (ymd(d) === ymd(now)) return fmtTime(iso);
  const diff = now.getTime() - d.getTime();
  if (diff < 6 * 86400000) return weekdayFmt.format(d);
  return dateFmt.format(d);
}

export function fmtDate(input?: string | null): string {
  if (!input) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00+07:00`) : new Date(input);
  if (isNaN(d.getTime())) return input;
  return fullFmt.format(d);
}

/** Day label for date separators in the conversation. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getTime() - 86400000));
  const key = ymd(d);
  if (key === today) return 'Hari ini';
  if (key === yesterday) return 'Kemarin';
  return fullFmt.format(d);
}

export function sameDay(a: string, b: string): boolean {
  return ymd(new Date(a)) === ymd(new Date(b));
}

export function todayYmd(): string {
  return ymd(new Date());
}
