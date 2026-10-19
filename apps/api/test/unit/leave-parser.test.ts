import { describe, expect, it } from 'vitest';
import { parseLeaveMessage } from '../../src/hr/leave-parser';

const today = '2026-10-19'; // Senin

describe('parseLeaveMessage', () => {
  it('kalimat jelas dengan tanggal lengkap menjadi pengajuan', () => {
    const r = parseLeaveMessage('Saya izin tidak masuk tanggal 21 Oktober 2026 karena urusan keluarga.', { today });
    expect(r.intent).toBe('LEAVE_REQUEST');
    expect(r.type).toBe('IZIN');
    expect(r.dateFrom).toBe('2026-10-21');
    expect(r.dateTo).toBe('2026-10-21');
    expect(r.reason).toContain('urusan keluarga');
    expect(r.missing).toEqual([]);
  });
  it('tanggal relatif: besok, lusa, hari ini', () => {
    expect(parseLeaveMessage('besok saya sakit, ke dokter', { today }).dateFrom).toBe('2026-10-20');
    expect(parseLeaveMessage('izin lusa ya', { today }).dateFrom).toBe('2026-10-21');
    expect(parseLeaveMessage('hari ini saya tidak masuk, demam', { today }).type).toBe('SAKIT');
  });
  it('rentang tanggal', () => {
    const r = parseLeaveMessage('Mau cuti 21 sampai 23 Oktober', { today });
    expect(r.type).toBe('CUTI');
    expect([r.dateFrom, r.dateTo]).toEqual(['2026-10-21', '2026-10-23']);
    const n = parseLeaveMessage('izin 21/10 - 22/10 keperluan keluarga', { today });
    expect([n.dateFrom, n.dateTo]).toEqual(['2026-10-21', '2026-10-22']);
  });
  it('nama hari menjadi tanggal berikutnya', () => {
    expect(parseLeaveMessage('izin hari rabu', { today }).dateFrom).toBe('2026-10-21');
    expect(parseLeaveMessage('izin jumat depan', { today }).dateFrom).toBe('2026-10-30');
  });
  it('"izin tanya" adalah pertanyaan, bukan pengajuan', () => {
    expect(parseLeaveMessage('Izin tanya, sisa cuti saya berapa?', { today }).intent).toBe('QUESTION');
    expect(parseLeaveMessage('mau tanya dong jam kerja besok?', { today }).intent).toBe('QUESTION');
  });
  it('negasi dan pembatalan', () => {
    expect(parseLeaveMessage('tidak jadi izin besok, saya masuk', { today }).intent).toBe('NEGATION');
    expect(parseLeaveMessage('batalkan izin saya', { today }).intent).toBe('NEGATION');
  });
  it('kutipan dan pesan terusan diabaikan', () => {
    expect(parseLeaveMessage('izin besok', { today, forwarded: true }).intent).toBe('NONE');
    expect(parseLeaveMessage('> izin besok', { today }).intent).toBe('NONE');
    expect(parseLeaveMessage('izin besok', { today, quoted: true }).intent).toBe('NONE');
  });
  it('"izin" sebagai kata sopan bukan ketidakhadiran', () => {
    expect(parseLeaveMessage('izin ambil sampel kain di gudang ya', { today }).intent).toBe('NONE');
    expect(parseLeaveMessage('izin pakai mobil kantor', { today }).intent).toBe('NONE');
  });
  it('tanpa tanggal meminta informasi minimum', () => {
    const r = parseLeaveMessage('saya izin ya', { today });
    expect(r.intent).toBe('LEAVE_REQUEST');
    expect(r.missing).toEqual(['date']);
  });
  it('tanggal terlalu lama dianggap ambigu', () => {
    expect(parseLeaveMessage('izin tanggal 1 Januari 2026', { today }).intent).toBe('AMBIGUOUS');
  });
  it('terlambat dan pulang awal', () => {
    expect(parseLeaveMessage('besok saya telat masuk, ada urusan bank', { today }).type).toBe('TERLAMBAT');
    expect(parseLeaveMessage('hari ini izin pulang lebih awal', { today }).type).toBe('PULANG_AWAL');
  });
  it('tanpa kata kunci tidak dianggap pengajuan', () => {
    expect(parseLeaveMessage('terima kasih bu', { today }).intent).toBe('NONE');
    expect(parseLeaveMessage('sudah saya kirim laporannya', { today }).intent).toBe('NONE');
  });
});
