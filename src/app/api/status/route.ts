import { aiEnabled, MODEL } from "@/server/ai";
import { persistence } from "@/server/store";

export async function GET() {
  return Response.json({ ai: aiEnabled(), model: aiEnabled() ? MODEL : null, persistence: persistence() });
}
