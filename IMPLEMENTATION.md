# PocketPot implementation plan

1. Build a pure, integer-only Hold'em engine and test betting, rotation, pots, undo, financial permissions, and exact settlement.
2. Build a responsive dark interface with room creation/joining, host approval, table, actions, audit, management, and settlement.
3. Put every mutation behind a validated server command. Add private local persistence for credential-free development and a Supabase compare-and-swap transaction adapter for deployment. Never send private buy-in totals to ordinary players or shared displays.
4. Add device recovery, optional authentication, paired displays, presence/expiry, retention, PWA assets, and deployment instructions.
5. Run deterministic engine tests, API permission/concurrency tests, browser flows at phone/desktop sizes, type checking, and a production build.

PocketPot is deployed on Vercel with Supabase persistence and anonymous guest authentication. The local file adapter is for a single development server only. See `DEPLOYMENT.md` for resource identifiers, configuration, and verification results.

## Rules references

Betting and reopening semantics are based on rules 43 and 47 in the [Poker TDA 2024 rules](https://www.pokertda.com/view-poker-tda-rules/); tournament-specific policies are not used. This cash-game implementation uses the handoff's no-missed-blinds policy and explicit host allocation of odd units.

Framework/auth references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Supabase anonymous sessions](https://supabase.com/docs/guides/auth/auth-anonymous).
