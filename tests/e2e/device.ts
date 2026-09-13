import { expect, request, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const origin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").origin;

/** Each browser and its API client share one independent, real guest session. */
export async function device(browser: Browser) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return browser.newContext({ baseURL: origin });
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("Hosted tests require NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  expect(error?.message, "Supabase anonymous sign-in must succeed").toBeUndefined();
  if (!data.session) throw new Error("Supabase did not return a guest session.");
  const context = await browser.newContext({
    baseURL: origin,
    storageState: {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [
            {
              name: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`,
              value: JSON.stringify(data.session),
            },
          ],
        },
      ],
    },
  });
  // Keep test API credentials out of browser requests and WebSocket handshakes.
  // The application sends its own Authorization header after loading this session.
  const api = await request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Authorization: `Bearer ${data.session.access_token}` },
  });
  return {
    request: api,
    newPage: context.newPage.bind(context),
    addInitScript: context.addInitScript.bind(context),
    setOffline: context.setOffline.bind(context),
    async close() {
      await api.dispose();
      await context.close();
    },
  };
}
