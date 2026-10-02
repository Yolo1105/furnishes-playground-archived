/**
 * Minimal workflow routes for standalone Studio.
 * Home points at `/` (this app) instead of the marketing site.
 */
export const WORKFLOW_ROUTES = {
  assistant: "/",
  style: "/",
  budget: "/",
  inspiration: "/",
  quiz: "/",
  collections: "/",
  home: "/",
} as const;

export type WorkflowRouteKey = keyof typeof WORKFLOW_ROUTES;
