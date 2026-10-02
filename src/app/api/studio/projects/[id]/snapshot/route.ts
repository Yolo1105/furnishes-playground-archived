import {
  PLAYGROUND_SNAPSHOT_MAX_BYTES,
  PutPlaygroundSnapshotBodySchema,
} from "@/lib/server/playground-persisted-schema";
import {
  getSnapshot,
  putSnapshot,
} from "@/lib/projects/local-project-store";

export const dynamic = "force-dynamic";

function paramId(params: { id: string }): string {
  return params.id;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const id = paramId(params);
  if (!id) {
    return Response.json({ error: "Missing project id" }, { status: 400 });
  }
  const row = await getSnapshot(id);
  if (!row) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(row);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const id = paramId(params);
  if (!id) {
    return Response.json({ error: "Missing project id" }, { status: 400 });
  }

  const text = await req.text();
  if (text.length > PLAYGROUND_SNAPSHOT_MAX_BYTES) {
    return Response.json(
      { error: "Snapshot payload too large" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PutPlaygroundSnapshotBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.message.slice(0, 300) },
      { status: 400 },
    );
  }

  const result = await putSnapshot(
    id,
    parsed.data.snapshot,
    parsed.data.expectedRevision,
  );
  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        currentRevision: result.currentRevision,
      },
      { status: result.status },
    );
  }
  return Response.json({ ok: true, revision: result.revision });
}
