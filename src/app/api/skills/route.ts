import { SKILL_IDS } from "@/lib/skills/catalog";
import { baselineMarkdown } from "@/server/skills";
import { serverError } from "@/server/http";

/** GET /api/skills?id=<skill> returns one baseline SKILL.md, unchanged. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const skill = SKILL_IDS.find((s) => s === id);
  if (!skill) return Response.json({ error: "Unknown skill.", skills: SKILL_IDS }, { status: 400 });
  try {
    return Response.json({ id: skill, markdown: await baselineMarkdown(skill) }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) {
    return serverError("skills.read_error", e);
  }
}
