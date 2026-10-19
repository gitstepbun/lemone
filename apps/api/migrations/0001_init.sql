-- Lemone Work directory + Chat + HR. Schemas: directory, chat, hr, ops.

-- ===================== DIRECTORY =====================
CREATE TABLE directory.organizations (
  id text PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO directory.organizations (id, name) VALUES ('lemone', 'PT Lemone Surya Indonesia');

-- Proyeksi master karyawan dari ERP (read model). Sumber resmi tetap ERP.
CREATE TABLE directory.employee_directory (
  org_id text NOT NULL REFERENCES directory.organizations(id),
  employee_id text NOT NULL,
  full_name text NOT NULL,
  division text NOT NULL,
  position text,
  manager_employee_id text,
  location text,
  work_status text NOT NULL CHECK (work_status IN ('ACTIVE','INACTIVE','ON_LEAVE','TERMINATED')),
  email text,
  phone text,
  source text NOT NULL,            -- 'ERP' | 'DEMO'
  source_version text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, employee_id)
);

CREATE TABLE directory.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES directory.organizations(id),
  employee_id text,
  username text NOT NULL,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('HUMAN','SERVICE')),
  status text NOT NULL CHECK (status IN ('PENDING_ACTIVATION','ACTIVE','DISABLED','NEEDS_REVIEW')),
  status_reason text,
  manual_disabled boolean NOT NULL DEFAULT false,  -- penonaktifan manual tidak boleh dibatalkan sinkronisasi ERP
  authz_version integer NOT NULL DEFAULT 1,
  idp_user_ref text,                          -- referensi provisioning stabil ke user IdP (bukan kredensial)
  tokens_not_before timestamptz,              -- token IdP yang diterbitkan sebelum ini ditolak (keluar dari semua perangkat)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (org_id, employee_id)
);
CREATE UNIQUE INDEX users_username_lower_uq ON directory.users (org_id, lower(username));

CREATE TABLE directory.identity_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  idp_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  UNIQUE (user_id, issuer)
);

CREATE TABLE directory.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  created_by uuid REFERENCES directory.users(id),
  token_hash bytea NOT NULL UNIQUE,
  delivery text NOT NULL CHECK (delivery IN ('HR_HANDOVER','EMAIL')),
  status text NOT NULL CHECK (status IN ('PENDING','RESERVED','CONSUMED','REVOKED','EXPIRED')),
  expires_at timestamptz NOT NULL,
  reserved_at timestamptz,
  activation_id uuid,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_user_idx ON directory.invitations (user_id, created_at DESC);

CREATE TABLE directory.activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES directory.invitations(id),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  status text NOT NULL CHECK (status IN ('STARTED','AWAITING_IDP','COMPLETED','FAILED','MISMATCH','EXPIRED')),
  expected_idp_user_id text,
  observed_subject text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  error text
);

CREATE TABLE directory.application_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  app text NOT NULL CHECK (app IN ('CHAT','WORK')),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  UNIQUE (user_id, app)
);

CREATE TABLE directory.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  role text NOT NULL CHECK (role IN ('OWNER','ACCOUNT_ADMIN','HR','APPROVER','EMPLOYEE')),
  scope_divisions text[],            -- NULL = semua divisi (hanya untuk OWNER/ACCOUNT_ADMIN penuh)
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz
);
CREATE INDEX role_assignments_user_idx ON directory.role_assignments (user_id) WHERE revoked_at IS NULL;

-- Petugas HR yang melayani inbox @hr untuk divisi tertentu
CREATE TABLE directory.hr_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hr_user_id uuid NOT NULL REFERENCES directory.users(id),
  divisions text[],                   -- NULL = semua divisi
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Username layanan resmi (@hr, @hr.ai, @lemone.ai). Dilindungi, terverifikasi.
CREATE TABLE directory.service_aliases (
  username text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES directory.users(id),
  kind text NOT NULL CHECK (kind IN ('HR_INBOX','AI_COMPANY','AI_HR','SYSTEM')),
  verified boolean NOT NULL DEFAULT true
);

CREATE TABLE directory.application_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  app text NOT NULL,
  client_id text NOT NULL,
  idp_session_state text,
  token_ciphertext bytea NOT NULL,     -- {access_token, refresh_token, id_token} AES-256-GCM
  access_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  user_agent text,
  ip text
);
CREATE INDEX application_sessions_user_idx ON directory.application_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE directory.device_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  app text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
  push_token_hash bytea,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Baris kunci untuk serialisasi perubahan administrator (perlindungan admin terakhir)
CREATE TABLE directory.org_locks (
  key text PRIMARY KEY
);
INSERT INTO directory.org_locks (key) VALUES ('admins');

-- ===================== OPS =====================
CREATE TABLE ops.provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                 -- PROVISION_ACCOUNT | DEACTIVATE_ACCOUNT | REVOKE_APP | LOGOUT_ALL | REISSUE_INVITATION
  user_id uuid REFERENCES directory.users(id),
  idempotency_key text NOT NULL UNIQUE,
  stage text NOT NULL DEFAULT 'INIT',
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','DONE','FAILED','NEEDS_REVIEW')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provisioning_jobs_due_idx ON ops.provisioning_jobs (next_run_at) WHERE status IN ('PENDING','RUNNING');

CREATE TABLE ops.outbox_events (
  id bigserial PRIMARY KEY,
  aggregate text NOT NULL,
  aggregate_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX outbox_due_idx ON ops.outbox_events (next_run_at) WHERE processed_at IS NULL;

CREATE TABLE ops.audit_events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_kind text NOT NULL,           -- USER | SYSTEM | WORKER
  action text NOT NULL,
  target_type text,
  target_id text,
  correlation_id text,
  outcome text NOT NULL,              -- OK | DENIED | FAILED
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_target_idx ON ops.audit_events (target_type, target_id, at DESC);

-- Simulator ERP berlabel DEMO. Dipakai hanya saat ERP_ADAPTER=demo.
CREATE TABLE ops.erp_demo_employees (
  employee_id text PRIMARY KEY,
  full_name text NOT NULL,
  division text NOT NULL,
  position text,
  manager_employee_id text,
  location text,
  work_status text NOT NULL,
  email text,
  phone text,
  shift_code text NOT NULL DEFAULT 'PAGI',
  version integer NOT NULL DEFAULT 1
);
CREATE TABLE ops.erp_demo_attendance_notes (
  id bigserial PRIMARY KEY,
  employee_id text NOT NULL,
  work_date date NOT NULL,
  note_type text NOT NULL,
  note text,
  source_ref text NOT NULL UNIQUE,    -- idempotency: request id + versi
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===================== CHAT =====================
CREATE TABLE chat.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('DM','GROUP','HR_INBOX','AI','ANNOUNCEMENT')),
  title text,
  dm_key text UNIQUE,                 -- DM: dua user_id terurut; HR_INBOX/AI: service:user
  service_user_id uuid REFERENCES directory.users(id),
  created_by uuid REFERENCES directory.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE chat.participants (
  conversation_id uuid NOT NULL REFERENCES chat.conversations(id),
  user_id uuid NOT NULL REFERENCES directory.users(id),
  role text NOT NULL CHECK (role IN ('MEMBER','ADMIN','OFFICER')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_read_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX participants_user_idx ON chat.participants (user_id) WHERE left_at IS NULL;

CREATE TABLE chat.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat.conversations(id),
  seq bigint NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES directory.users(id),
  via_service_user_id uuid REFERENCES directory.users(id),  -- petugas HR membalas sebagai @hr
  client_msg_id uuid,
  kind text NOT NULL CHECK (kind IN ('TEXT','SYSTEM','CARD','VOICE','FILE')),
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reply_to_id uuid,
  forwarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq)
);
CREATE UNIQUE INDEX messages_client_idx ON chat.messages (conversation_id, sender_user_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

-- ===================== HR =====================
CREATE TABLE hr.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_user_id uuid NOT NULL REFERENCES directory.users(id),
  employee_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('IZIN','SAKIT','CUTI','TERLAMBAT','PULANG_AWAL')),
  date_from date NOT NULL,
  date_to date NOT NULL,
  shift_code text,
  reason text,
  source text NOT NULL CHECK (source IN ('CHAT','MANUAL')),
  source_message_id uuid,
  conversation_id uuid,
  card_message_id uuid,
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED','NEEDS_INFO')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  erp_sync_status text NOT NULL DEFAULT 'NOT_SENT' CHECK (erp_sync_status IN ('NOT_SENT','PENDING','SYNCED','FAILED','AMBIGUOUS','NOT_CONNECTED')),
  erp_reference text,
  erp_last_error text,
  erp_attempts integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leave_requests_emp_idx ON hr.leave_requests (employee_user_id, created_at DESC);
CREATE INDEX leave_requests_status_idx ON hr.leave_requests (status, created_at DESC);

CREATE TABLE hr.leave_request_history (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES hr.leave_requests(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  action text NOT NULL,
  snapshot jsonb NOT NULL
);
