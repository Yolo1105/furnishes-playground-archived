import type { Conversation } from "./types";

/** Client-side conversation id (matches historical Studio shape). */
export function newConversationId(): string {
  return `convo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Empty conversation row for a project (local-only until Eva sync). */
export function emptyConversation(
  projectId: string,
  title?: string,
): Conversation {
  const now = Date.now();
  return {
    id: newConversationId(),
    projectId,
    title: title ?? "Conversation 1",
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}
