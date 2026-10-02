"use client";

import type { ProjectSnapshot } from "./snapshot";

export type PlaygroundSnapshotGetResponse = {
  revision: number | null;
  snapshot: unknown | null;
};

const revisionByProject = new Map<string, number>();

export function setPlaygroundServerRevision(
  projectId: string,
  revision: number,
) {
  revisionByProject.set(projectId, revision);
}

export function getPlaygroundServerRevision(
  projectId: string,
): number | undefined {
  return revisionByProject.get(projectId);
}

export function clearPlaygroundServerRevision(projectId: string) {
  revisionByProject.delete(projectId);
}

export async function fetchPlaygroundSnapshotFromServer(
  projectId: string,
): Promise<PlaygroundSnapshotGetResponse> {
  const res = await fetch(
    `/api/studio/projects/${encodeURIComponent(projectId)}/snapshot`,
    { credentials: "include" },
  );
  if (!res.ok) {
    return { revision: null, snapshot: null };
  }
  return (await res.json()) as PlaygroundSnapshotGetResponse;
}

export type PutPlaygroundSnapshotResult =
  | { ok: true; revision: number; status: number }
  | {
      ok: false;
      status: number;
      currentRevision?: number;
      error?: string;
    };

export async function putPlaygroundSnapshotToServer(
  projectId: string,
  snapshot: ProjectSnapshot,
  expectedRevision: number | undefined,
): Promise<PutPlaygroundSnapshotResult> {
  const body =
    expectedRevision !== undefined
      ? { expectedRevision, snapshot }
      : { snapshot };

  const res = await fetch(
    `/api/studio/projects/${encodeURIComponent(projectId)}/snapshot`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (res.ok) {
    const data = (await res.json()) as { ok?: boolean; revision?: number };
    return {
      ok: true,
      revision: typeof data.revision === "number" ? data.revision : 1,
      status: res.status,
    };
  }

  let err: { error?: string; currentRevision?: number } = {};
  try {
    err = (await res.json()) as typeof err;
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    status: res.status,
    currentRevision: err.currentRevision,
    error: err.error,
  };
}
