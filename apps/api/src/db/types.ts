import type { ColumnType, Generated, JSONColumnType } from 'kysely';

type Ts = ColumnType<Date, Date | string, Date | string>;
type TsNull = ColumnType<Date | null, Date | string | null, Date | string | null>;
type GenTs = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T extends object | null> = JSONColumnType<T>;
type JsonGen<T extends object | null> = ColumnType<T, string | undefined, string>;

export interface EmployeeDirectoryTable {
  org_id: string;
  employee_id: string;
  full_name: string;
  division: string;
  position: string | null;
  manager_employee_id: string | null;
  location: string | null;
  work_status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED';
  email: string | null;
  phone: string | null;
  source: string;
  source_version: string | null;
  synced_at: GenTs;
}

export type UserStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'DISABLED' | 'NEEDS_REVIEW';
export interface UsersTable {
  id: Generated<string>;
  org_id: string;
  employee_id: string | null;
  username: string;
  display_name: string;
  kind: 'HUMAN' | 'SERVICE';
  status: UserStatus;
  status_reason: string | null;
  manual_disabled: Generated<boolean>;
  authz_version: Generated<number>;
  idp_user_ref: string | null;
  tokens_not_before: TsNull;
  created_at: GenTs;
  updated_at: GenTs;
  disabled_at: TsNull;
}

export interface IdentityBindingsTable {
  id: Generated<string>;
  user_id: string;
  issuer: string;
  subject: string;
  idp_user_id: string;
  created_at: GenTs;
}

export type InvitationStatus = 'PENDING' | 'RESERVED' | 'CONSUMED' | 'REVOKED' | 'EXPIRED';
export interface InvitationsTable {
  id: Generated<string>;
  user_id: string;
  created_by: string | null;
  token_hash: Buffer;
  delivery: 'HR_HANDOVER' | 'EMAIL';
  status: InvitationStatus;
  expires_at: Ts;
  reserved_at: TsNull;
  activation_id: string | null;
  consumed_at: TsNull;
  revoked_at: TsNull;
  revoked_by: string | null;
  created_at: GenTs;
}

export interface ActivationsTable {
  id: Generated<string>;
  invitation_id: string;
  user_id: string;
  status: 'STARTED' | 'AWAITING_IDP' | 'COMPLETED' | 'FAILED' | 'MISMATCH' | 'EXPIRED';
  expected_idp_user_id: string | null;
  observed_subject: string | null;
  started_at: GenTs;
  expires_at: Ts;
  completed_at: TsNull;
  error: string | null;
}

export type AppName = 'CHAT' | 'WORK';
export interface ApplicationGrantsTable {
  id: Generated<string>;
  user_id: string;
  app: AppName;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
  granted_by: string | null;
  granted_at: GenTs;
  revoked_by: string | null;
  revoked_at: TsNull;
}

export type Role = 'OWNER' | 'ACCOUNT_ADMIN' | 'HR' | 'APPROVER' | 'EMPLOYEE';
export interface RoleAssignmentsTable {
  id: Generated<string>;
  user_id: string;
  role: Role;
  scope_divisions: string[] | null;
  assigned_by: string | null;
  assigned_at: GenTs;
  revoked_by: string | null;
  revoked_at: TsNull;
}

export interface HrAssignmentsTable {
  id: Generated<string>;
  hr_user_id: string;
  divisions: string[] | null;
  assigned_by: string | null;
  assigned_at: GenTs;
  revoked_at: TsNull;
}

export interface ServiceAliasesTable {
  username: string;
  user_id: string;
  kind: 'HR_INBOX' | 'AI_COMPANY' | 'AI_HR' | 'SYSTEM';
  verified: Generated<boolean>;
}

export interface ApplicationSessionsTable {
  id: Generated<string>;
  user_id: string;
  app: string;
  client_id: string;
  idp_session_state: string | null;
  token_ciphertext: Buffer;
  access_expires_at: Ts;
  created_at: GenTs;
  last_seen_at: GenTs;
  revoked_at: TsNull;
  revoke_reason: string | null;
  user_agent: string | null;
  ip: string | null;
}

export interface DeviceRegistrationsTable {
  id: Generated<string>;
  user_id: string;
  app: string;
  platform: 'ANDROID' | 'IOS' | 'WEB';
  push_token_hash: Buffer | null;
  device_label: string | null;
  created_at: GenTs;
  revoked_at: TsNull;
}

export interface OrgLocksTable {
  key: string;
}

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'NEEDS_REVIEW';
export interface ProvisioningJobsTable {
  id: Generated<string>;
  kind: string;
  user_id: string | null;
  idempotency_key: string;
  stage: Generated<string>;
  status: JobStatus;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  next_run_at: GenTs;
  locked_at: TsNull;
  locked_by: string | null;
  last_error: string | null;
  payload: Json<Record<string, unknown>>;
  result: JsonGen<Record<string, unknown>>;
  correlation_id: string | null;
  created_at: GenTs;
  updated_at: GenTs;
}

export interface OutboxEventsTable {
  id: Generated<number>;
  aggregate: string;
  aggregate_id: string;
  type: string;
  payload: Json<Record<string, unknown>>;
  correlation_id: string | null;
  created_at: GenTs;
  attempts: Generated<number>;
  next_run_at: GenTs;
  processed_at: TsNull;
  last_error: string | null;
}

export interface AuditEventsTable {
  id: Generated<number>;
  at: GenTs;
  actor_user_id: string | null;
  actor_kind: 'USER' | 'SYSTEM' | 'WORKER';
  action: string;
  target_type: string | null;
  target_id: string | null;
  correlation_id: string | null;
  outcome: 'OK' | 'DENIED' | 'FAILED';
  details: Json<Record<string, unknown>>;
}

export interface ErpDemoEmployeesTable {
  employee_id: string;
  full_name: string;
  division: string;
  position: string | null;
  manager_employee_id: string | null;
  location: string | null;
  work_status: string;
  email: string | null;
  phone: string | null;
  shift_code: Generated<string>;
  version: Generated<number>;
}

export interface ErpDemoAttendanceNotesTable {
  id: Generated<number>;
  employee_id: string;
  work_date: ColumnType<string, string, string>;
  note_type: string;
  note: string | null;
  source_ref: string;
  created_at: GenTs;
}

export type ConversationType = 'DM' | 'GROUP' | 'HR_INBOX' | 'AI' | 'ANNOUNCEMENT';
export interface ConversationsTable {
  id: Generated<string>;
  type: ConversationType;
  title: string | null;
  dm_key: string | null;
  service_user_id: string | null;
  created_by: string | null;
  created_at: GenTs;
  last_message_at: TsNull;
  last_seq: Generated<number>;
}

export interface ParticipantsTable {
  conversation_id: string;
  user_id: string;
  role: 'MEMBER' | 'ADMIN' | 'OFFICER';
  joined_at: GenTs;
  left_at: TsNull;
  last_read_seq: Generated<number>;
}

export type MessageKind = 'TEXT' | 'SYSTEM' | 'CARD' | 'VOICE' | 'FILE';
export interface MessagesTable {
  id: Generated<string>;
  conversation_id: string;
  seq: number;
  sender_user_id: string;
  via_service_user_id: string | null;
  client_msg_id: string | null;
  kind: MessageKind;
  body: string | null;
  payload: JsonGen<Record<string, unknown>>;
  reply_to_id: string | null;
  forwarded: Generated<boolean>;
  created_at: GenTs;
}

export type LeaveType = 'IZIN' | 'SAKIT' | 'CUTI' | 'TERLAMBAT' | 'PULANG_AWAL';
export type LeaveStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'NEEDS_INFO';
export type ErpSyncStatus = 'NOT_SENT' | 'PENDING' | 'SYNCED' | 'FAILED' | 'AMBIGUOUS' | 'NOT_CONNECTED';
export interface LeaveRequestsTable {
  id: Generated<string>;
  employee_user_id: string;
  employee_id: string;
  type: LeaveType;
  date_from: ColumnType<string, string, string>;
  date_to: ColumnType<string, string, string>;
  shift_code: string | null;
  reason: string | null;
  source: 'CHAT' | 'MANUAL';
  source_message_id: string | null;
  conversation_id: string | null;
  card_message_id: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: TsNull;
  decision_note: string | null;
  erp_sync_status: Generated<ErpSyncStatus>;
  erp_reference: string | null;
  erp_last_error: string | null;
  erp_attempts: Generated<number>;
  version: Generated<number>;
  created_at: GenTs;
  updated_at: GenTs;
}

export interface LeaveRequestHistoryTable {
  id: Generated<number>;
  request_id: string;
  at: GenTs;
  actor_user_id: string | null;
  action: string;
  snapshot: Json<Record<string, unknown>>;
}

export interface SchemaMigrationsTable {
  name: string;
  applied_at: GenTs;
}

export interface DB {
  'directory.employee_directory': EmployeeDirectoryTable;
  'directory.users': UsersTable;
  'directory.identity_bindings': IdentityBindingsTable;
  'directory.invitations': InvitationsTable;
  'directory.activations': ActivationsTable;
  'directory.application_grants': ApplicationGrantsTable;
  'directory.role_assignments': RoleAssignmentsTable;
  'directory.hr_assignments': HrAssignmentsTable;
  'directory.service_aliases': ServiceAliasesTable;
  'directory.application_sessions': ApplicationSessionsTable;
  'directory.device_registrations': DeviceRegistrationsTable;
  'directory.org_locks': OrgLocksTable;
  'ops.provisioning_jobs': ProvisioningJobsTable;
  'ops.outbox_events': OutboxEventsTable;
  'ops.audit_events': AuditEventsTable;
  'ops.erp_demo_employees': ErpDemoEmployeesTable;
  'ops.erp_demo_attendance_notes': ErpDemoAttendanceNotesTable;
  'ops.schema_migrations': SchemaMigrationsTable;
  'chat.conversations': ConversationsTable;
  'chat.participants': ParticipantsTable;
  'chat.messages': MessagesTable;
  'hr.leave_requests': LeaveRequestsTable;
  'hr.leave_request_history': LeaveRequestHistoryTable;
}
