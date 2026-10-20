-- Akun pendaftaran mandiri tanpa ERP: username menjadi nomor karyawan agar alur izin/absensi DEMO berjalan.
INSERT INTO directory.employee_directory (org_id, employee_id, full_name, division, work_status, source)
SELECT u.org_id, u.username, u.display_name, 'Umum', 'ACTIVE', 'PENDAFTARAN'
FROM directory.users u
JOIN directory.local_credentials c ON c.user_id = u.id
WHERE u.employee_id IS NULL
ON CONFLICT (org_id, employee_id) DO NOTHING;

UPDATE directory.users u SET employee_id = u.username
FROM directory.local_credentials c
WHERE c.user_id = u.id AND u.employee_id IS NULL;
