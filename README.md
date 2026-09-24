# PocketPot

A mobile-first, private chip ledger for in-person No-Limit Texas Hold’em. Use real cards; PocketPot handles legal betting, stacks, pots, corrections, and exact settlement. It never evaluates cards or moves money.

## Run locally

Requires Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. No credentials are required. Create a room, or choose **Try a practice table** to start a four-player table you can operate through the explicit **Record spoken action** host control. Practice seats do not act automatically.

For real separate-device testing, create a normal room. Open a separate browser profile/incognito window, enter its room code, request a seat, and approve it from the host’s **Room & players** screen. To test phones on your own network, use the development computer’s LAN address on every device. The listener binds to `0.0.0.0`; OS firewall settings may need to allow the chosen port. Installation and some device features require HTTPS (localhost is a browser exception).

Local mode stores private JSON room files in `.pocketpot/`. It supports multiple browser clients connected to **one Node.js process** and recovers rooms after that process restarts. It is a development adapter, not a distributed database. Do not run several servers against that directory. Local mode explicitly refuses to run on Vercel.

Local cleanup runs when a browser initializes a session. Production cleanup runs through the authenticated scheduled endpoint. In long-running active rooms, detailed events, undo snapshots, and old join requests are also pruned at 90 days; one-way command fingerprints remain to preserve duplicate protection.

## Implemented

- HKD/IDR, whole units, configurable buy-ins, blinds and individual antes.
- Host-approved joins, rebuys, cash-outs, device recovery, and read-only screen pairing; optional Supabase Google and passwordless-email authentication.
- Server-authoritative betting with heads-up action order, full/minimum raises, cumulative short-all-in reopening, uncalled returns, main/side pots, eligible winners, and explicit allocation of odd split units.
- A choice of own-device actions or host/co-host recording of spoken moves, with audited out-of-turn corrections and step-by-step undo. New rooms pause between betting streets for the cards by default; the host or co-host continues play after the reveal. All-in runouts go straight to showdown. Financial/seating/role changes establish an undo boundary so financial approvals cannot be erased by gameplay undo.
- Prominent turn, phase, and last-move announcements on phones and paired displays, plus optional per-device table sounds.
- Numbered virtual seats, next-button/blind preview, sitting out, co-host appointment, and explicit host transfer.
- Host-only cumulative buy-in data. All approved players can paginate the public audit. Private financial details are removed before the server response is built.
- Exact zero-sum settlement, a minimum-transfer payment list, individual confirmations, dispute resolution, JSON export, and finalization without unanimous confirmation.
- Last-confirmed-state offline pause, idempotent retries after uncertain responses, per-device sound/vibration, and a PWA manifest, icons, standalone mode, and offline explanation. No financial state is cached by the service worker.
- Supabase persistence, row-level policies, transactional compare-and-swap writes, realtime version notifications with polling fallback, rate limits, recovery/expiry, retained registered-user summaries, and deletion controls.

The current MVP limits **the entire session to 10 participants**, including players who cash out. It supports 2–10 active players but does not yet support an unlimited succession of replacement participants. The exact settlement optimizer is intentionally bounded by this limit.

## Play a night

1. The host creates a room and shares its QR/code. The host’s initial buy-in is approved at creation.
2. Friends request a name and buy-in. The host approves them between hands.
3. Review seats, then deal the first hand. Physical cards and winner decisions stay with the people at the table.
4. In individual mode, each player says their move aloud and enters it on their own device. In spoken mode, the host or co-host records everyone's announced moves. The host can switch modes between hands. A raise input is the **total for the current street**, including money already bet that street.
5. With card pauses enabled, reveal the flop, turn, or river before the host or co-host presses **Cards are out · continue**. This setting can change between hands. When nobody has a betting decision left after all-ins, play goes straight to showdown. Undo is available without action-confirmation dialogs.
6. At showdown, assign each pot to one or more eligible winners. For a split, choose exactly the required number of winners to receive one additional unit each.
7. Between hands, handle rebuys/cash-outs, availability, blinds, and seat changes. To leave as host, transfer ownership first.
8. End the session, review all totals, resolve disagreements, and finalize. The payment list describes transfers people make outside PocketPot.

## Supabase and Vercel setup

PocketPot is deployed at **https://pocketpot.vercel.app**, backed by the **PocketPot** Supabase project in the **capski** organization (Singapore, Free plan) and Vercel Hobby. Anonymous guest access, private persistence, Realtime, and the protected daily cleanup job are configured. See `DEPLOYMENT.md` for deployment details and verification evidence.

1. For a separate installation, create a Supabase project and apply every SQL file in `supabase/migrations/` in filename order. They include the realtime publication, ownership-policy optimizations, and compatibility with hosted safe-update enforcement.
2. In Supabase Authentication, enable anonymous sign-ins so guests need no registration. Configure Google OAuth and email OTP/magic links if registered accounts are desired. Set Site URL and allowed redirect URLs to your local and eventual production URLs. Configure appropriate anonymous-auth abuse protection and email delivery in the project settings.
3. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The current installation uses a modern publishable key and a server-only secret key under these existing variable names. Never give a server key a `NEXT_PUBLIC_` prefix.
4. Generate an unguessable `CRON_SECRET` of at least 32 bytes. Configure it locally if exercising cleanup, and in Vercel before enabling the scheduler.
5. Run the checks below, then test two browser identities against your Supabase project. Verify auth redirects, realtime, room recovery, pairing/revocation, account history, and cleanup with the actual credentials.
6. Link the intended Vercel Next.js project and configure the four variables for production. For the current linked workspace, `scripts/configure-vercel-env.mjs` uploads values through stdin and stores server credentials as Vercel Secrets; existing values must be managed through Vercel's environment settings. Deploy using `npx vercel deploy --prod --yes --archive tgz`. No extra WebSocket server is needed: Supabase sends version notifications, and Next.js APIs serve filtered room snapshots.
7. `vercel.json` schedules `/api/cleanup` daily at 03:17 UTC. The route requires Vercel’s `Authorization: Bearer <CRON_SECRET>` header. Verify the cron ran successfully; do not assume retention is operating merely because the code was deployed.

Supabase mode activates when `NEXT_PUBLIC_SUPABASE_URL` is set. Set all three Supabase variables together. A build can succeed without these credentials, but that credential-free build is for local preview; Vercel requests intentionally fail closed without persistence configuration.

## Identity, durability, and access

The local adapter issues an opaque, random, HttpOnly, SameSite=Strict device cookie. Only its SHA-256 digest identifies membership; the cookie itself is never placed in a room response. Supabase mode instead verifies access tokens with `auth.getUser()` on the server, including anonymous sessions.

A room code locates the approval lobby, not membership. Only an approved device receives the table. Recovery requires an exact existing name and host approval; it removes the previous device’s mapping. A paired display receives stacks/bets/pots but no financial ledger, settlement, controls, or audit. The host can revoke displays, including after finalization.

Clients cannot select or mutate private room/event tables through Supabase. Server-only functions atomically compare the version, persist the new state and audit event, update approved memberships, and emit a version signal. A command UUID is scoped to its authenticated identity; retries return the current state without applying the command twice. A conflicting different command receives HTTP 409, with no silent rebasing.

An unfinished room becomes inaccessible 24 hours after its last approved-device heartbeat. GET heartbeats and approved commands maintain presence; pending guest requests do not extend it. A finalized room, including guests’ result access, lasts 90 days. Scheduled cleanup removes room state, snapshots, command receipts, and event rows together. Registered users retain **their own** aggregate summary independently of the deleted detailed room. Account history offers summary deletion and account deletion; active sessions must be finished before account deletion. Shared room records involving other participants remain until room retention ends.

## Verification

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

For a production PWA smoke test, run `npm run start -- -p 3001` after building, then `node scripts/verify-pwa.mjs`. It checks the manifest, icons, static-only service-worker cache, offline navigation, and reconnection.

The Playwright configuration uses installed Microsoft Edge by default on Windows. On another system, remove `channel: "msedge"` in `playwright.config.ts` and install Playwright Chromium with `npx playwright install chromium`.

For hosted verification, put the selected project's Supabase URL, public key, and cleanup secret in `.env.local`, then set `PLAYWRIGHT_BASE_URL` to the HTTPS deployment URL before running `npm run test:e2e`. The runner will use that deployment without starting localhost. Each test device gets its own anonymous Supabase identity, shared between its browser and API requests. Hosted tests use real player rooms instead of the local-only practice endpoint, and traces are disabled to avoid recording authentication headers. Run against an approved deployment: the tests create real test rooms and guests, and invoke the retention cleanup endpoint.

The hosted suite additionally requires a Realtime WebSocket notification with polling disabled, verifies a guest action through the UI, and checks both unauthorized and authenticated cleanup requests. A successful manual cleanup request does not prove that Vercel's daily scheduler has executed.

- Engine/room tests cover deterministic edge cases, authorization, privacy, idempotency, undo, settlement, and 150 randomized complete hands with conservation checks after each action.
- Database tests execute the actual migration in embedded PostgreSQL (PGlite), with a small mock of Supabase’s `auth.users`, `auth.uid()`, and API roles. They verify transactional conflicts, RLS/privileges, membership signals, rate limits, summary ownership, and cleanup.
- Browser/API tests cover separate host/guest identities, approval, a complete hand, settlement/disputes, duplicate/concurrent writes, CSRF rejection, offline pause/reconnect, recovery, paired-display privacy, and phone/desktop layouts.
- The optimized Next.js build checks that all routes and client bundles compile without production credentials.

**Live verification:** Anonymous Supabase Auth, Vercel multiplayer gameplay and persistence, Realtime delivery with polling disabled, privacy/recovery controls, authenticated cleanup, and production PWA offline/reconnection behavior have passed. Optional Google OAuth and email delivery remain unconfigured/unverified. The daily cron is enabled in Vercel and its endpoint has been exercised manually; its first scheduled invocation has not yet been observed. PWA installation and vibration behavior also vary by actual browser/device.

## Repository map

| Path                    | Responsibility                                                               |
| ----------------------- | ---------------------------------------------------------------------------- |
| `src/lib/poker.ts`      | Pure betting engine, positions, pots, integer validation                     |
| `src/lib/room.ts`       | Authority, finance, undo, audited commands, privacy projections              |
| `src/lib/settlement.ts` | Exact minimum-transfer settlement via zero-sum partitions                    |
| `src/lib/server/`       | Verified identities, local/Supabase persistence, rate limits                 |
| `src/app/api/`          | Validated commands, projections, audit pagination, account/cleanup endpoints |
| `src/components/`       | Landing, table, host controls, approval, audit, settlement                   |
| `supabase/migrations/`  | Private schema, RLS, atomic commit and cleanup functions                     |
| `tests/`                | Engine, PostgreSQL, browser and API tests                                    |
| `public/`               | PWA manifest, original vector/PNG icons, offline shell                       |

Fonts are self-hosted. There is no external font request, remote card service, payment SDK, analytics, or public room listing. Common UI vocabulary lives in `src/lib/strings.ts`; v1 is English-only.

Implementation references: [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Poker TDA betting and reopening rules](https://www.pokertda.com/view-poker-tda-rules/). The app uses the handoff’s friendly cash-game sitting-out policy rather than tournament policies.
