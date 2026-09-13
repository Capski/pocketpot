import { body, fail, identity, json, sameOrigin } from "@/lib/server/http";
import { mutateRoom, rateLimit } from "@/lib/server/store";
import { envelopeSchema } from "@/lib/commands";
import { applyCommand, project } from "@/lib/room";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const user = await identity(request);
    await rateLimit(user, "commands");
    const { id } = await params;
    const input = envelopeSchema.parse(await body(request));
    const room = await mutateRoom(id, (r) =>
      applyCommand(r, user, input.command, input.key, input.version),
    );
    return json(project(room, user));
  } catch (e) {
    return fail(e);
  }
}
