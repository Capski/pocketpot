import { cleanup } from "@/lib/server/store";
import { fail, json } from "@/lib/server/http";
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return new Response("Unauthorized", { status: 401 });
  try {
    return json({ removed: await cleanup() });
  } catch (e) {
    return fail(e);
  }
}
