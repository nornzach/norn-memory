/** Where a memory or exact record was written. Memories keep these in metadata. */
export interface Provenance {
  device?: string | null;
  agent?: string | null;
  project?: string | null;
  cwd?: string | null;
  key_label?: string | null;
}

export interface Memory {
  id: string;
  memory: string;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  categories?: string[];
  metadata?: Record<string, unknown>;
  /** YYYY-MM-DD; hidden from listings and search after this day unless show_expired is set. */
  expiration_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type ApiKeyAccess = "read" | "read_write";

/** Empty lists mean no restriction on that field. */
export interface ApiKeyScopes {
  access: ApiKeyAccess;
  user_ids: string[];
  agent_ids: string[];
  run_ids: string[];
  categories: string[];
}

export interface ApiKey extends ApiKeyScopes {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  /** Whether the full key can be shown again; false for keys made before keys were kept. */
  retrievable: boolean;
}

export interface ApiKeySecret {
  id: string;
  key: string;
}

export interface ApiKeyCreateResponse extends ApiKeyScopes {
  id: string;
  label: string;
  key: string;
  key_prefix: string;
  created_at: string;
}

export interface ApiRequestLog {
  id: string;
  created_at: string;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  auth_type: string;
  key_label?: string | null;
}

export type EntityType = "user" | "agent" | "run";

export interface Entity {
  id: string;
  type: EntityType;
  total_memories: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface Category {
  id: string;
  name: string;
  description: string;
  memory_count: number;
  created_at: string;
}

export interface CategoryBackfillResponse {
  queued: number;
  message: string;
}

export const WEBHOOK_EVENTS = [
  "memory.created",
  "memory.updated",
  "memory.deleted",
  "memories.deleted_all",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  is_active: boolean;
  secret_prefix: string;
  created_at: string;
  last_delivery_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
}

export interface WebhookCreateResponse extends Webhook {
  secret: string;
}

export interface WebhookTestResponse {
  status_code: number | null;
  error: string | null;
  ok: boolean;
}

export type AnalyticsRange = "24h" | "7d" | "30d";

export interface AnalyticsResponse {
  range: AnalyticsRange;
  granularity: "hour" | "day";
  totals: {
    requests: number;
    errors: number;
    success_rate: number | null;
    avg_latency_ms: number | null;
    p95_latency_ms: number | null;
  };
  series: { bucket: string; requests: number; errors: number }[];
  endpoints: {
    method: string;
    path: string;
    requests: number;
    errors: number;
    avg_latency_ms: number;
  }[];
  total_memories: number;
  categories: { name: string; memories: number }[];
}

export type ConsolidationRunStatus = "running" | "completed" | "failed";

export type ConsolidationProposalStatus =
  | "proposed"
  | "applied"
  | "dismissed"
  | "stale"
  | "failed";

export interface ConsolidationSource {
  id: string;
  memory: string;
  created_at: string | null;
  categories: string[];
}

export interface ConsolidationProposal {
  id: string;
  run_id: string;
  kind: "merge" | "supersede";
  status: ConsolidationProposalStatus;
  target_id: string;
  remove_ids: string[];
  new_text: string | null;
  sources: ConsolidationSource[];
  reason: string;
  error: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ConsolidationRun {
  id: string;
  status: ConsolidationRunStatus;
  scope: Partial<Record<"user_id" | "agent_id" | "run_id", string>>;
  threshold: number;
  memories_scanned: number;
  clusters_found: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  actions: Partial<Record<ConsolidationProposalStatus, number>>;
}

export interface ConsolidationRunDetail extends ConsolidationRun {
  proposals: ConsolidationProposal[];
}

export interface ConsolidationApplyAllResponse {
  applied: number;
  stale: number;
  failed: number;
}

// Keep in sync with SUGGESTED_KINDS in server/exact_store.py.
export const EXACT_KINDS = [
  "credential",
  "account",
  "server",
  "api_key",
  "url",
  "person",
  "date",
  "address",
  "note",
] as const;

export interface ExactRecord extends Provenance {
  id: string;
  user_id: string;
  key: string;
  kind: string;
  title: string | null;
  description: string | null;
  tags: string[];
  // Values are any JSON, returned exactly as written.
  fields: Record<string, unknown>;
  version: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ExactRecordVersion extends Provenance {
  version: number;
  change: "update" | "delete";
  replaced_at: string | null;
  kind?: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  fields?: Record<string, unknown>;
}

export interface ExactHistory {
  key: string;
  current: ExactRecord | null;
  versions: ExactRecordVersion[];
}
