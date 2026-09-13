import { body, fail, identity, json, sameOrigin } from "@/lib/server/http";
import { findRoom, identifiers, insertRoom, rateLimit } from "@/lib/server/store";
import { createSchema } from "@/lib/commands";
import { createRoom, project } from "@/lib/room";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await identity(request);
    await rateLimit(user, "create", 5);
    const input = createSchema.parse(await body(request));
    const { id, code } = identifiers();
    const room = createRoom(id, code, user, input.name, input.playerName, input.config);
    await insertRoom(room);
    return json(project(room, user));
  } catch (e) {
    return fail(e);
  }
}
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    await rateLimit(user, "lookup", 20);
    const room = await findRoom(new URL(request.url).searchParams.get("code")?.toUpperCase() ?? "");
    return json(project(room, user));
  } catch (e) {
    return fail(e);
  }
}
