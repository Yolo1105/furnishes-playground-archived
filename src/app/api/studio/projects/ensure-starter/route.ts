import { ensureStarterProject } from "@/lib/projects/local-project-store";

export const dynamic = "force-dynamic";

export async function POST() {
  const project = await ensureStarterProject();
  return Response.json({ project });
}
