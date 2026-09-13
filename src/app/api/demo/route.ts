import { body, fail, identity, json, sameOrigin } from "@/lib/server/http";
import { cloud, identifiers, insertRoom, rateLimit } from "@/lib/server/store";
import { applyCommand, createRoom, project } from "@/lib/room";
import { ensure } from "@/lib/poker";
import { randomUUID } from "node:crypto";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    ensure(
      !cloud && !process.env.VERCEL,
      "Practice tables are available in local development only.",
    );
    const user = await identity(request);
    await rateLimit(user, "create", 5);
    await body(request);
    const { id, code } = identifiers();
    let r = createRoom(id, code, user, "The Friday Table", "You", {
      currency: "HKD",
      buyIn: 500,
      minBuyIn: 100,
      maxBuyIn: 2000,
      smallBlind: 5,
      bigBlind: 10,
      ante: 0,
    });
    for (const name of ["Jamie", "Morgan", "Riley"]) {
      const key = randomUUID();
      r = applyCommand(
        r,
        randomUUID(),
        { type: "request", kind: "join", name, amount: 500 },
        key,
        r.version,
      );
      r = applyCommand(r, user, { type: "approve", requestId: key }, randomUUID(), r.version);
    }
    r = applyCommand(r, user, { type: "start" }, randomUUID(), r.version);
    await insertRoom(r);
    return json(project(r, user));
  } catch (e) {
    return fail(e);
  }
}
