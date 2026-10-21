# Deal with the Devil frontend

React + TypeScript + Vite client for the Spring Boot API. The API contract is in
[`../docs/frontend-api-contract.md`](../docs/frontend-api-contract.md).

## Run locally

1. Start the backend on `http://localhost:8080`.
2. In this directory, install dependencies and create your local environment file:

   ```powershell
   npm install
   Copy-Item .env.example .env.local
   ```

3. Set `VITE_GOOGLE_CLIENT_ID` in `.env.local` to the Google OAuth web client ID
   accepted by the backend. Add `http://localhost:5173` as an authorized
   JavaScript origin in Google Cloud.
4. Run the client:

   ```powershell
   npm run dev
   ```

Vite runs at `http://localhost:5173`. `.env.local` is ignored by Git; do not
commit credentials. `VITE_API_URL` defaults to `http://localhost:8080`.

## Current implementation

The frontend includes Google and fallback admin sign-in, profile completion,
session-scoped JWT storage and refresh, role-specific participant/admin
navigation, and responsive screens for the auction catalog and bid drawer,
won-problem workspace, admin round command center, participant roster, history,
leaderboard, rules, problem/hint management, wallet actions, ledger and audit
log. Countdown calculations use the backend's `serverTime`.

The frontend uses the merged backend API for the following workflows:

- Participant auction: tier-filtered problem cards, question previews and a bid
  drawer. The balance check follows the backend rule that only the participant's
  three highest bids count toward their wallet balance; coins are not escrowed
  before settlement.
- Won-problem workspace: shows the participant's own wins, clearing prices,
  HackerRank links and wallet history. Hints and Devil's deal/redemption actions
  remain admin-managed; participants cannot trigger those actions directly.
- Admin command center: shows the round phase pipeline, deadline controls,
  settlement summary, preview-phase slot dry-run/apply, bidding-phase coverage,
  and solving-phase allocation, auto-fill and manual assignment.
- Problem bank: edits the participant-facing question preview through its
  dedicated preview endpoint while the problem's round is in `PREVIEW`.
- Participant roster: uses server-side name/HackerRank ID search, individual
  wallet/account actions, and the idempotent bulk-credit endpoint.

The settlement summary does not expose ranked bids or the identities of bidders.
The allocation view shows participant win counts and unsold slots after
settlement, but not per-bid rankings. Participants do not have self-service hint
or Devil's deal/redemption actions.

Build and lint checks:

```powershell
npm run build
npm run lint
```

## Next steps before the event

- Add the Google OAuth client ID to `.env.local`, then verify Google login with
  the live backend and database.
- Run through a complete round with test accounts, including bid limits,
  deadline/pause behavior, slot allocation, settlement, auto-fill, manual
  assignments, wallet actions and undo.
- Review the four implemented screens against the supplied designs and adjust
  any visual details that should differ while keeping API behavior accurate.
