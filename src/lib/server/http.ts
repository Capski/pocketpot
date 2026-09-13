import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { admin, cloud } from "./store";
import { ensure } from "../poker";
export async function identity(request: Request) {
  if (cloud) {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    ensure(token, "Sign in to continue.");
    const { data, error } = await admin().auth.getUser(token);
    ensure(!error && data.user, "Your session expired. Reconnect and try again.");
    return data.user.id;
  }
  ensure(!process.env.VERCEL, "Supabase must be configured for deployment.");
  const jar = await cookies();
  const token = jar.get("pocketpot_device")?.value;
  ensure(token && /^[a-f0-9]{64}$/.test(token), "Initialize this device first.");
  return createHash("sha256").update(token).digest("hex");
}
export async function initializeDevice() {
  const jar = await cookies();
  if (!jar.get("pocketpot_device"))
    jar.set("pocketpot_device", randomBytes(32).toString("hex"), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 90 * 86400,
    });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  // Next's internal URL may use 0.0.0.0 behind a development listener or proxy.
  // Browsers control Host and Origin; neither is an application body parameter.
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const publicOrigin = `${protocol}://${request.headers.get("host") ?? url.host}`;
  ensure(origin === publicOrigin, "Cross-origin mutations are not allowed.");
}
export async function body(request: Request) {
  ensure(Number(request.headers.get("content-length") ?? 0) < 16384, "Request too large.");
  const text = await request.text();
  ensure(text.length < 16384, "Request too large.");
  return JSON.parse(text);
}
export function fail(e: unknown) {
  const message = e instanceof Error ? e.message : "Request failed.";
  return Response.json(
    { error: message.includes('"issues"') ? "Check the supplied values." : message },
    { status: message.includes("changed") ? 409 : 400, headers: { "Cache-Control": "no-store" } },
  );
}
export function json(data: unknown) {
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
