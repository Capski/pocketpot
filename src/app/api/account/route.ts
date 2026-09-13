import { admin, cloud, rateLimit } from "@/lib/server/store";
import { body, fail, identity, json, sameOrigin } from "@/lib/server/http";
import { ensure } from "@/lib/poker";
export async function GET(request: Request) {
  try {
    ensure(cloud, "Account history requires Supabase.");
    const user = await identity(request);
    const { data, error } = await admin()
      .from("pocketpot_summaries")
      .select("*")
      .eq("user_id", user)
      .order("finalized_at", { ascending: false });
    ensure(!error, "Could not load history.");
    return json(data);
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    ensure(cloud, "Accounts are not enabled in local mode.");
    const user = await identity(request);
    await rateLimit(user, "delete", 5);
    const input = await body(request);
    if (input.scope === "history") {
      const { error } = await admin().from("pocketpot_summaries").delete().eq("user_id", user);
      ensure(!error, "Could not delete history.");
    } else if (input.scope === "account") {
      const db = admin();
      const { data, error } = await db
        .from("pocketpot_members")
        .select("room_id,pocketpot_rooms!inner(finalized_at)")
        .eq("user_id", user)
        .is("pocketpot_rooms.finalized_at", null);
      ensure(!error, "Could not check active rooms.");
      ensure(!data?.length, "Finish active sessions before deleting your account.");
      const deleted = await db.auth.admin.deleteUser(user);
      ensure(!deleted.error, "Could not delete account.");
    } else throw new Error("Choose history or account deletion.");
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
