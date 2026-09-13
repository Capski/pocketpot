# PocketPot deployment

Verified on 2026-09-11. Production: **https://pocketpot.vercel.app**.

## Resources

- Supabase: **PocketPot**, project `vbvwwchmzyhudfgdixwj`, capski organization `ykivbsigmtppnwbohdnc`, Singapore, **$0/month** at provisioning.
- Vercel: **pocketpot**, project `prj_Is1hiz4OuEAfbfsg5YO7sA6wg23F`, team `team_X7m1uNAFMEBloX4kUA75XlEH`, **Hobby**.
- Production deployment: `dpl_64JzsYU55nuRKFHT395Qr9iDGHSj`, READY, Next.js 16.3.4, Node.js 24.x.
- Immutable URL: https://pocketpot-bxgj6dj3q-christoopog-gmailcoms-projects.vercel.app
- Runtime functions: Singapore (`sin1`). Remote build completed in 32 seconds.
- The existing Capski's Project was left paused.

## Configuration

Anonymous sign-in is enabled. Site URL is the production URL, with exact production and localhost redirect URLs. The anonymous sign-in allowance is restored to 30/hour/IP after testing; a fresh guest sign-in succeeded after restoration.

Production has four environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET`. The public variable uses a modern publishable key; the server variable uses a modern secret key. Server credentials and the random 32-byte cleanup secret are stored as Vercel Secrets. Local credentials are in ignored `.env.local`; the temporary key-export file was removed. Preview credentials were not configured.

All six tables have RLS enabled. Only the server role may execute room commits, and authenticated clients cannot select private room state. The signals table is published to Supabase Realtime.

Applied migrations, with local filenames aligned to remote history:

1. `20260911004100_pocketpot.sql` — schema, private data policies, atomic commits, realtime and retention.
2. `20260911004402_optimize_membership_policies.sql` — membership index and per-query identity evaluation.
3. `20260911005157_allow_cleanup_with_safeupdate.sql` — limit history-pruning updates to rooms that need pruning, compatible with hosted safe-update enforcement.

Security advisors reported only informational notices for the three intentionally server-only tables with no client policies ([Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Performance warnings were resolved.

## Verification evidence

- **All seven hosted Playwright tests passed in 53.5 seconds**, using the public production URL and independent Supabase identities.
- Covered create/join/host approval, complete hand and pot assignment, settlement/disputes/finalization, private projections, duplicate/stale commands, CSRF rejection, offline pause/reconnect, ten-seat mobile layout, device recovery, and display pairing/revocation.
- Realtime test disabled the 3-second polling fallback, waited for the database-ready message, received actual WebSocket change notifications, and submitted the guest's Check through the UI.
- Cleanup rejected a missing secret with 401 and succeeded with the correct secret.
- Production PWA passed manifest/icons, static-only service-worker cache, offline navigation, and reconnect checks.
- TypeScript passed. All 41 engine/database tests passed with every migration applied. The production Next.js build passed.
- Vercel production log scans returned no error-level logs or 5xx requests.
- Direct Supabase queries confirmed persisted rooms, events, memberships, and a finalized settlement.

The hosted tests create isolated test guests and rooms that follow the normal retention policy.

## Operations and remaining optional checks

Vercel confirms the cleanup cron is enabled for `/api/cleanup`, scheduled daily at 03:17 UTC. Its authenticated endpoint was verified manually. The first scheduler-triggered invocation has not yet been observed.

Optional Google OAuth and email delivery are not configured/verified. Guest multiplayer requires neither. Physical-device PWA installation and vibration were not tested.

This workspace has no Git repository, so there is no commit SHA or automatic Git deployment. Publish subsequent source changes from the linked workspace with `npx vercel deploy --prod --yes --archive tgz`. Update database migrations separately before deploying dependent application changes.

The connected Supabase plugin provisioned the project, applied migrations, and verified database state. Auth configuration and secure Vercel environment/deployment operations used the user-authenticated CLIs. The Vercel connector continued returning an empty project list, so deployment readiness, logs, domains, and cron configuration were verified through Vercel CLI/API instead.
