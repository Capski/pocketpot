import { fail, identity, json } from "@/lib/server/http";
import { readRoom, touchRoom, rateLimit } from "@/lib/server/store";
import { project, roleFor } from "@/lib/room";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await identity(request);
    await rateLimit(user, "read", 120);
    const { id } = await params;
    const room = await readRoom(id);
    if (roleFor(room, user) !== "pending") await touchRoom(id);
    return json(project(room, user));
  } catch (e) {
    return fail(e);
  }
}
