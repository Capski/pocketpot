import { cloud, cleanup } from "@/lib/server/store";
import { initializeDevice, json, fail, sameOrigin } from "@/lib/server/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (!cloud) {
      await cleanup();
      await initializeDevice();
    }
    return json({ mode: cloud ? "supabase" : "local" });
  } catch (e) {
    return fail(e);
  }
}
