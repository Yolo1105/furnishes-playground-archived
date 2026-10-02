import { z } from "zod";
import {
  deleteProject,
  renameProject,
} from "@/lib/projects/local-project-store";

export const dynamic = "force-dynamic";

const PatchBodySchema = z.object({
  name: z.string().min(1).max(200),
});

function paramId(params: { id: string }): string {
  return params.id;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const id = paramId(params);
  if (!id) {
    return Response.json({ error: "Missing project id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const project = await renameProject(id, parsed.data.name);
  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ project });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const params = await ctx.params;
  const id = paramId(params);
  if (!id) {
    return Response.json({ error: "Missing project id" }, { status: 400 });
  }
  const ok = await deleteProject(id);
  if (!ok) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
