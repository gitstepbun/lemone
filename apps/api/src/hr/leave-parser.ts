import { addDays, businessDate, weekday } from '../common/time';
import type { LeaveType } from '../db/types';

export type Intent = 'LEAVE_REQUEST' | 'QUESTION' | 'NEGATION' | 'NONE' | 'AMBIGUOUS';

export interface ParseResult {
  intent: Intent;
  type: LeaveType | null;
  dateFrom: string | null;
  dateTo: string | null;
  reason: string | null;
  /** Informasi minimum yang masih kurang. */
  missing: Array<'date' | 'type'>;
  /** Alasan interpretasi (untuk audit/uji). */
  notes: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  agu: 8, agt: 8, agustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, des: 12, desember: 12,
};
const DAYS: Record<string, number> = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6 };

function pad(n: number) { return String(n).padStart(2, '0'); }
function ymd(y: number, m: number, d: number) { return `${y}-${pad(m)}-${pad(d)}`; }
function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[“”"']/g, "'").replace(/\s+/g, ' ').trim();
}

/** Ekstrak satu atau dua tanggal (YYYY-MM-DD) dari teks. */
export function extractDates(text: string, today: string): { from: string | null; to: string | null; notes: string[] } {
  const t = normalize(text);
  const notes: string[] = [];
  const [ty, tm] = today.split('-').map(Number);

  // Relatif
  if (/\bhari ini\b/.test(t)) return { from: today, to: today, notes: ['hari ini'] };
  if (/\blusa\b/.test(t)) return { from: addDays(today, 2), to: addDays(today, 2), notes: ['lusa'] };
  if (/\bbesok\b/.test(t)) {
    const m = t.match(/\bbesok\b(?:\s*(?:dan|sampai|s\/d|hingga|-)\s*lusa)/);
    if (m) return { from: addDays(today, 1), to: addDays(today, 2), notes: ['besok sampai lusa'] };
    const dur = t.match(/\b(\d{1,2})\s*hari\b/);
    if (dur) return { from: addDays(today, 1), to: addDays(today, Number(dur[1])), notes: ['besok, durasi hari'] };
    return { from: addDays(today, 1), to: addDays(today, 1), notes: ['besok'] };
  }
  if (/\bkemarin\b/.test(t)) return { from: addDays(today, -1), to: addDays(today, -1), notes: ['kemarin (lapor terlambat)'] };

  // Rentang tanggal numerik: 21-23 oktober, 21 sampai 23 oktober 2026, 21/10 - 23/10
  const monthRe = '(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|agt|sep(?:t|tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)';
  const sep = '(?:\\s*(?:-|–|sampai|s\\/d|sd|hingga|dan)\\s*)';
  let m = t.match(new RegExp(`\\b(\\d{1,2})${sep}(\\d{1,2})\\s+${monthRe}(?:\\s+(\\d{4}))?`));
  if (m) {
    const mo = MONTHS[m[3]]; const y = m[4] ? Number(m[4]) : ty;
    if (valid(y, mo, Number(m[1])) && valid(y, mo, Number(m[2]))) return { from: ymd(y, mo, Number(m[1])), to: ymd(y, mo, Number(m[2])), notes: ['rentang tanggal'] };
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})\\s+${monthRe}(?:\\s+(\\d{4}))?${sep}(\\d{1,2})\\s+${monthRe}(?:\\s+(\\d{4}))?`));
  if (m) {
    const y1 = m[3] ? Number(m[3]) : ty; const y2 = m[6] ? Number(m[6]) : y1;
    const a = ymd(y1, MONTHS[m[2]], Number(m[1])); const b = ymd(y2, MONTHS[m[5]], Number(m[4]));
    if (valid(y1, MONTHS[m[2]], Number(m[1])) && valid(y2, MONTHS[m[5]], Number(m[4]))) return { from: a, to: b, notes: ['rentang tanggal'] };
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})[\\/\\-](\\d{1,2})(?:[\\/\\-](\\d{2,4}))?${sep}(\\d{1,2})[\\/\\-](\\d{1,2})(?:[\\/\\-](\\d{2,4}))?`));
  if (m) {
    const y1 = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ty;
    const y2 = m[6] ? (m[6].length === 2 ? 2000 + Number(m[6]) : Number(m[6])) : y1;
    if (valid(y1, Number(m[2]), Number(m[1])) && valid(y2, Number(m[5]), Number(m[4]))) return { from: ymd(y1, Number(m[2]), Number(m[1])), to: ymd(y2, Number(m[5]), Number(m[4])), notes: ['rentang numerik'] };
  }

  // Tanggal tunggal: 21 oktober 2026 / 21 okt / tanggal 21
  m = t.match(new RegExp(`\\b(\\d{1,2})\\s+${monthRe}(?:\\s+(\\d{4}))?`));
  if (m) {
    const mo = MONTHS[m[2]]; const y = m[3] ? Number(m[3]) : ty; const d = Number(m[1]);
    if (valid(y, mo, d)) {
      const from = ymd(y, mo, d);
      const dur = t.match(/\b(\d{1,2})\s*hari\b/);
      return { from, to: dur ? addDays(from, Number(dur[1]) - 1) : from, notes: ['tanggal tunggal'] };
    }
  }
  m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ty;
    if (valid(y, Number(m[2]), Number(m[1]))) { const from = ymd(y, Number(m[2]), Number(m[1])); return { from, to: from, notes: ['tanggal numerik'] }; }
  }
  m = t.match(/\b(?:tanggal|tgl\.?)\s*(\d{1,2})\b/);
  if (m) {
    const d = Number(m[1]);
    if (valid(ty, tm, d)) { const from = ymd(ty, tm, d); notes.push('tanggal tanpa bulan: bulan ini'); return { from, to: from, notes }; }
  }
  // Nama hari: "senin", "hari rabu", "jumat depan". "minggu" hanya bila didahului "hari".
  m = t.match(/\b(?:hari\s+(minggu)|(senin|selasa|rabu|kamis|jumat|jum'at|sabtu))\b(\s+depan)?/);
  if (m) {
    const name = m[1] ?? m[2];
    const target = DAYS[name];
    const cur = weekday(today);
    let delta = (target - cur + 7) % 7;
    if (delta === 0) delta = 7;
    if (m[3] && delta < 7 && target > cur) delta += 7; // "depan" = minggu berikutnya bila hari itu masih di minggu ini
    const from = addDays(today, delta);
    return { from, to: from, notes: ['nama hari → tanggal berikutnya'] };
  }
  return { from: null, to: null, notes };
}

export function detectType(t: string): LeaveType | null {
  if (/\bsakit\b|\bdemam\b|\bflu\b|\bke dokter\b|\bopname\b/.test(t)) return 'SAKIT';
  if (/\bcuti\b/.test(t)) return 'CUTI';
  if (/\bterlambat\b|\btelat\b|\bdatang siang\b/.test(t)) return 'TERLAMBAT';
  if (/\bpulang (lebih )?(awal|cepat|duluan)\b/.test(t)) return 'PULANG_AWAL';
  if (/\b(izin|ijin)\b|\b(tidak|gak|nggak|ga|engga|enggak|tdk) (bisa )?masuk\b|\btidak hadir\b|\babsen\b|\bgak hadir\b|\bnggak hadir\b/.test(t)) return 'IZIN';
  return null;
}

export function extractReason(t: string): string | null {
  const m = t.match(/\b(?:karena|krn|sebab|soalnya|dikarenakan|untuk|ada)\s+(.{3,160}?)(?:[.!,]|$)/i);
  return m ? m[1].trim() : null;
}

/**
 * Interpretasi pesan ke inbox HR. Deterministik, tanpa AI, supaya pengajuan tetap jalan saat AI tidak tersedia.
 */
export function parseLeaveMessage(text: string, opt: { today?: string; forwarded?: boolean; quoted?: boolean } = {}): ParseResult {
  const today = opt.today ?? businessDate();
  const t = normalize(text);
  const base: ParseResult = { intent: 'NONE', type: null, dateFrom: null, dateTo: null, reason: null, missing: [], notes: [] };
  if (!t) return base;
  if (opt.forwarded || opt.quoted || /^>/.test(t) || /\bfwd\b|\bforward\b|\bditeruskan\b/.test(t)) return { ...base, intent: 'NONE', notes: ['pesan terusan/kutipan diabaikan'] };

  // Pertanyaan: "izin tanya", "mau tanya", kalimat tanya tentang kebijakan
  if (/\b(izin|ijin|mau|boleh|numpang|minta)\s+(tanya|bertanya|nanya)\b/.test(t) || /\b(bagaimana|gimana|apakah|berapa|kapan|bolehkah|bisakah)\b.*\?/.test(t) || (/\?\s*$/.test(t) && !/\b(izin|ijin|cuti|sakit)\b.*\b(tanggal|besok|hari ini|lusa)\b/.test(t))) {
    return { ...base, intent: 'QUESTION', notes: ['kalimat tanya'] };
  }
  // Negasi/pembatalan
  if (/\b(tidak|gak|nggak|ga|batal|bukan)\s+jadi\b|\bbatal(kan)?\s+(izin|ijin|cuti|pengajuan)\b|\bjadi masuk\b|\bbukan izin\b/.test(t)) {
    return { ...base, intent: 'NEGATION', notes: ['negasi/pembatalan'] };
  }
  const type = detectType(t);
  if (!type) return { ...base, intent: 'NONE', notes: ['tidak ada kata kunci izin'] };
  // "izin" sebagai kata sopan untuk hal lain: "izin ambil barang", "izin pakai mobil"
  if (type === 'IZIN' && /\b(izin|ijin)\s+(ambil|pakai|pinjam|bawa|masuk ruang|lewat|share|kirim|tanya)\b/.test(t) && !/\b(tidak|gak|nggak) masuk\b/.test(t)) {
    return { ...base, intent: 'NONE', notes: ['"izin" sebagai kata sopan, bukan ketidakhadiran'] };
  }
  const dates = extractDates(t, today);
  const reason = extractReason(text);
  const missing: ParseResult['missing'] = [];
  if (!dates.from) missing.push('date');
  let intent: Intent = 'LEAVE_REQUEST';
  const notes = [...dates.notes];
  if (dates.from) {
    const diff = (new Date(`${dates.from}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000;
    if (diff < -7) { intent = 'AMBIGUOUS'; notes.push('tanggal lebih dari 7 hari lalu'); }
    if (diff > 366) { intent = 'AMBIGUOUS'; notes.push('tanggal terlalu jauh'); }
    if (dates.to && dates.to < dates.from) { intent = 'AMBIGUOUS'; notes.push('rentang terbalik'); }
  }
  return { intent, type, dateFrom: dates.from, dateTo: dates.to ?? dates.from, reason, missing, notes };
}
