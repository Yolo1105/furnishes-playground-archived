/**
 * Anthropic model used by every server caller in this app: chat,
 * suggestions, arrange, explain, room orchestrator, and asset
 * derivation. One constant so a deprecation is a one-line fix.
 */

export const BRAIN_ANTHROPIC_MODEL = "claude-sonnet-4-6";
