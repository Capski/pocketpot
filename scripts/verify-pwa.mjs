import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const origin = process.env.POCKETPOT_PREVIEW_URL ?? "http://localhost:3001";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator('.home-page[data-ready="true"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const manifest = await (await page.request.get(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.length, 2);
  for (const icon of manifest.icons)
    assert.equal((await page.request.get(origin + icon.src)).status(), 200);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.screenshot({ path: "test-results/production-home.png", fullPage: true });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname),
        ),
      )
    ).flat();
  });
  assert.deepEqual(cached.sort(), ["/icon.svg", "/offline.html"]);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "Your table is on hold." }).waitFor();
  assert.equal(
    await page.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0),
    true,
  );
  await context.setOffline(false);
  await page.getByRole("link", { name: "Reconnect" }).click();
  await page.locator('.home-page[data-ready="true"]').waitFor();
  // The practice endpoint is intentionally unavailable on hosted deployments.
  // Check that reconnection restores the normal room creation flow instead.
  await page.getByRole("button", { name: "Create a room", exact: true }).click();
  await page.getByLabel("Your display name").waitFor();
  assert.equal(await page.getByRole("button", { name: "Create private room" }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PWA verified: manifest, icons, service worker, static-only cache, offline navigation and reconnect.",
  );
} finally {
  await browser.close();
}
