export const AUTH_ENDPOINTS = {
  SETUP_STATUS: "/auth/setup-status",
  REGISTER: "/auth/register",
  LOGIN: "/auth/login",
  REFRESH: "/auth/refresh",
  ME: "/auth/me",
  CHANGE_PASSWORD: "/auth/change-password",
} as const;

export const MEMORY_ENDPOINTS = {
  BASE: "/memories",
  BY_ID: (memoryId: string) => `/memories/${memoryId}`,
  HISTORY: (memoryId: string) => `/memories/${memoryId}/history`,
  CONFIGURE: "/configure",
  CONFIGURE_PROVIDERS: "/configure/providers",
  CONFIGURE_TEST: "/configure/test",
  RESET: "/reset",
  GENERATE_INSTRUCTIONS: "/generate-instructions",
} as const;

export const API_KEY_ENDPOINTS = {
  BASE: "/api-keys",
  BY_ID: (keyId: string) => `/api-keys/${keyId}`,
} as const;

export const REQUEST_ENDPOINTS = {
  BASE: "/requests",
} as const;

export const ENTITY_ENDPOINTS = {
  BASE: "/entities",
  BY_ID: (type: string, id: string) =>
    `/entities/${type}/${encodeURIComponent(id)}`,
} as const;

export const CATEGORY_ENDPOINTS = {
  BASE: "/categories",
  BY_ID: (categoryId: string) => `/categories/${categoryId}`,
  BACKFILL: "/categories/backfill",
} as const;

export const WEBHOOK_ENDPOINTS = {
  BASE: "/webhooks",
  BY_ID: (webhookId: string) => `/webhooks/${webhookId}`,
  TEST: (webhookId: string) => `/webhooks/${webhookId}/test`,
} as const;

export const ANALYTICS_ENDPOINTS = {
  BASE: "/analytics",
} as const;

export const EXPORT_ENDPOINTS = {
  BASE: "/export",
} as const;

export const CONSOLIDATION_ENDPOINTS = {
  RUNS: "/consolidation/runs",
  RUN: (runId: string) => `/consolidation/runs/${runId}`,
  APPLY_RUN: (runId: string) => `/consolidation/runs/${runId}/apply`,
  APPLY: (proposalId: string) => `/consolidation/proposals/${proposalId}/apply`,
  DISMISS: (proposalId: string) =>
    `/consolidation/proposals/${proposalId}/dismiss`,
} as const;

// Keys contain "/", which the server reads as part of the path; only the segments are escaped.
const exactKeyPath = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

export const EXACT_ENDPOINTS = {
  RECORDS: "/exact/records",
  RECORD: (key: string) => `/exact/records/${exactKeyPath(key)}`,
  HISTORY: (key: string) => `/exact/history/${exactKeyPath(key)}`,
  BATCH: "/exact/batch",
} as const;
