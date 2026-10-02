import { z } from "zod";
import {
  createProject,
  listProjects,
} from "@/lib/projects/local-project-store";

export const dynamic = "force-dynamic";

const CreateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export async function GET() {
  const projects = await listProjects();
  return Response.json({ projects });
}

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const project = await createProject(parsed.data.name);
  return Response.json({ project });
}
