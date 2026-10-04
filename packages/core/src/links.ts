/**
 * In-app addresses the worker writes into `notifications.link`. They must be real pages
 * of `apps/web` (a test checks each one against `apps/web/src/app`): the customer area
 * lives under `/app`.
 */
export const APP_LINKS = {
  connections: () => "/app/collegamenti",
  connection: (connectionId: string) => `/app/collegamenti/${connectionId}`,
  scrapeRecipe: (recipeId: string) => `/app/collegamenti/siti/${recipeId}`,
  conversation: (conversationId: string) => `/app/inbox/${conversationId}`,
  inbox: () => "/app/inbox",
  approvals: () => "/app/approvazioni",
  report: () => "/app/report",
  flow: (flowId: string) => `/app/flussi/${flowId}`,
  flowRun: (flowId: string, runId: string) => `/app/flussi/${flowId}/esecuzioni/${runId}`,
} as const;
