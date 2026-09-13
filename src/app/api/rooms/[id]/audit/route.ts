import { fail, identity, json } from "@/lib/server/http";
import { readRoom } from "@/lib/server/store";
import { visibleAudit } from "@/lib/room";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await identity(request);
    const room = await readRoom((await params).id);
    const before = Number(
      new URL(request.url).searchParams.get("before") ?? Number.MAX_SAFE_INTEGER,
    );
    return json(
      visibleAudit(room, user)
        .filter((e) => e.seq < before)
        .slice(-100),
    );
  } catch (e) {
    return fail(e);
  }
}
