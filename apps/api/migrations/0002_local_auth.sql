-- Autentikasi lokal (AUTH_MODE=local): username + sandi tanpa IdP eksternal.
CREATE TABLE directory.local_credentials (
  user_id uuid PRIMARY KEY REFERENCES directory.users(id),
  password_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Pendaftaran mandiri tidak memerlukan employee_id; kolom sudah nullable. Nama tampilan dari pendaftar.
