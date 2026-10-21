# Hacker Auction: Project Context

Read this first. It captures every design decision made so far, so anyone joining the project can get up to speed without re-asking. Build status is tracked in `roadmap.md`; every endpoint and response shape is in `frontend-api-contract.md`.

## 1. What the event is

A competitive tech event where participants use virtual coins to bid on tech problems (debugging, logic, crypto-lite, puzzles). Problems are solved on **HackerRank**. This app handles everything around the contest: login, coins, sealed bidding, results, hints and the leaderboard.

## 2. Key decisions (final unless marked open)

| Topic | Decision |
|---|---|
| Participants | **Individual**, not teams |
| Auction type | **Vickrey-style sealed-bid (blind)** auction |
| Winners | **One problem can go to many winners** (k slots per problem) |
| Rounds and problems per person | **3 contest rounds**, each with its own problems. In every round each participant must end with **exactly 3 problems** (built, see section 3a and Phase 9 in `roadmap.md`) |
| Steal / open pool / dynamic pricing | **Dropped** |
| Solving | On **HackerRank**. The app only hosts the preview, links and hint passwords |
| Hints | Three hint versions per problem, one per corruption level. **All hints cost the same.** Which version a participant gets depends on their corruption level |
| Hint purchase | **Manual by admin.** No in-app hint purchase |
| Corruption level | 3 levels per participant. Visible to the participant. Can go **up or down** |
| The devil | Exchanges corruption level for coins: take corruption, get coins. Reversing it (level down) costs coins |
| Admin actions | Pre-built buttons with a confirm popup (see section 5) |
| Roles and views | Two roles, PARTICIPANT and ADMIN. Admins see a different app (the admin panel) from participants (the participant app). The login response includes the role so React shows the right one, and the backend blocks `/api/admin/**` for non-admins on its own. Every service method also carries its own role or ownership check (`@PreAuthorize` with `AccessGuard`), so a participant can only read or change their own data even if a controller is wrong |
| Pop-ups | After each transaction, the participant sees a pop-up (bid won or lost, hint deducted, credits, level change) |
| Mystery assets | **On hold** for now |
| Coins | Whole-number coins preferred; no floating-point money |
| Backend | **Java + Spring Boot** |
| Auth | **Google sign-in, then our own JWT.** React gets a Google ID token, sends it to the backend, the backend verifies it and issues its own **JWT valid 3 hours by default** (`app.auth.jwt-expiry-hours`; the frontend calls `POST /api/auth/refresh` before it runs out) so participants don't have to log in again. A Spring Security filter validates the JWT (sent in the `Authorization: Bearer` header) on every request. Admin role comes from an email allowlist in the config file |
| Frontend | **React JS** |
| Exact numbers | Prices, rewards, devil exchange rates and hint price are **to be decided later** (kept in a config file) |

## 3. How settlement pricing works

1. Each participant places one secret bid per problem, editable until the bidding deadline.
2. Admin closes bidding and runs settlement.
3. Eligible bids across the round are ranked by amount, then submission time, then bid ID. A bid is accepted only while its participant is below the three-win limit and its problem has a free slot.
4. All winners of a problem pay the same price: the highest bid rejected because that problem was already full. If no bid is rejected for that reason, winners pay the problem's base price (reserve).
5. Ties go to the earlier submission; bid ID breaks an exact timestamp tie.
6. Coins are deducted atomically, the ledger is written, and each participant gets a win or lose pop-up.

When the three-win cap does not affect selection, this is the ordinary multi-slot Vickrey price: the (k+1)th bid for k slots, or the reserve if there are too few bids. With the global cap, that shortcut is not always accurate; see section 3a for the complete rule.

Example when the cap does not affect selection (k = 2): bids 90, 70, 50, 30. The top two win and both pay 50.

Edge case (handled in two places, see section 3a): a participant could win several problems whose prices add up to more than their balance. Bids are capped when they are placed: a participant's 3 highest bids in a round together cannot exceed their coins (`BID_EXCEEDS_BALANCE`; only the top 3 count because nobody can win more than 3), and a bid below the problem's reserve price is rejected. If an admin deducts coins after bidding, a winner who can no longer pay is marked `UNAFFORDABLE` at settlement and the slot is not reassigned by settlement (auto fill can hand that unsold slot to someone short).

## 3a. Exactly 3 problems per person (built, design agreed 2026-10-20)

The number 3 lives in `game.wins-per-round`. The earlier per-problem settlement let someone win 0 or 10 problems; the built design has three parts:

1. **Auto slots.** One admin button (`POST /api/admin/rounds/current/slots/auto`, PREVIEW phase only, with a dry run) sets the slots of every problem in the round: total = 3 x participants, spread evenly over the problems (remainder gives one extra slot each), no problem above the participant count. This always gives enough slots: with at least 3 problems, 3N / P is at most N, so the total is always exactly 3N. Nobody hand-edits slots; the admin presses the button again whenever a new participant has signed in. Opening bidding is blocked if total slots are below 3 x participants (decided 2026-10-20). Example: 32 participants and 10 problems = 96 slots = 4 problems with 9 and 6 with 10.
2. **Global allocation with a cap of 3 wins.** Settlement runs once over all bids of the round instead of once per problem: sort by amount, then earlier submission, then bid id; accept a bid only if the person has fewer than 3 wins and the problem still has a free slot. A problem's price is the first bid rejected because the problem was full, else the reserve price. The bid rule becomes "sum of your 3 highest bids at most your coins".
3. **Auto fill after settlement.** Anyone with fewer than 3 wins gets problems from the unsold slots at the reserve price (skipping problems they already hold and ones they cannot afford; the person with the fewest problems goes first, and the problem with the most unsold slots). Whatever it cannot finish is listed as `stillShort` for **manual assignment** (the admin gives a specific problem at the reserve price, even over the problem's slots if needed). Both only work in the SOLVING phase and are logged like normal wins. Before bidding closes, **bid coverage** shows who has bid on few or no problems; after settlement, the **allocation view** flags everyone not at 3 and shows unsold slots.

Auto-filled and manually assigned problems cost the **reserve price** (decided 2026-10-20).

Exactly 3 per person per round is a **hard rule** (decided 2026-10-20). Someone who never bids is covered by the auto fill (they get 3 problems at the reserve price if they can afford it).

Assumptions: everyone bids on every problem, no late sign-ups after the slots are set, no admin coin deductions between bidding and settlement. The cap alone cannot guarantee exactly 3 (with exactly 3N slots there is no margin), which is why the auto fill exists.

## 4. Round flow

Preview → Sealed bidding → Settlement → Solving (HackerRank) → Results → Next round

All phase changes are controlled by the admin.

## 5. Deliverables

### Backend (Spring Boot)
- Auth endpoint: verify the Google ID token (signature, audience, expiry, verified email), find or create the user, issue our own JWT (2 to 3 hours). The frontend sends it as `Authorization: Bearer <token>` on every request. A JWT filter in the Spring Security chain checks it on every request. Admin role via email allowlist in config
- Wallet and ledger: atomic updates, every change logged (admin, reason, amount, balance after)
- Round state machine
- Sealed-bid engine with a server-side deadline
- Vickrey settlement
- Problem bank: title, category, tier, slots, HackerRank link
- Corruption level per participant (3 levels, up or down)
- 3 hint versions per problem with passwords
- Admin actions API (all atomic and logged):
  - Generic hint deduction (participant + problem number)
  - Preset credits (solved Bronze, Silver, Gold)
  - Devil's deal (coins up, level up)
  - Redemption (coins down, level down)
  - Custom amount, undo via reversing ledger entry
  - Bulk credit: give every participant the same number of coins in one click (`POST /api/admin/wallet/credit-all`, built). Each participant still gets their own ledger entry and pop-up; a request id makes a double click harmless
- Result events for participant pop-ups (polling or Server-Sent Events, no WebSockets needed)
- Leaderboard
- Config file for tier prices, rewards, hint price, preset amounts, devil rates
- Safety: balance and level-limit checks, audit log (built), ownership and role checks (built), rate limiting (so far only on the backup admin sign-in)

### Frontend (React)

**Participant app**
- Login and dashboard (coins, round, phase, timer, corruption level)
- Round preview (title, hint teaser, category, tier)
- Sealed bid screen
- Transaction pop-ups
- My problems (HackerRank link) and transaction history
- Leaderboard, notifications, rules page

**Admin panel**
- Round and phase controls (start, advance, pause, next round)
- Auction controls (open/close bidding, run settlement, override)
- Problem bank manager
- Participant manager with corruption level editing
- Preset buttons with confirm popups: hint, credits, devil's deal, redemption, custom, undo
- Ledger and log viewer

### Non-software
- HackerRank contests and problems (Bronze, Silver, Gold)
- 3 hint versions per problem, with passwords
- Prices, rewards, hint price, devil exchange rates
- Event logistics: registration, intro session, number of rounds and problems per round

## 6. Safeguards to build in
- Confirm popup before every admin deduction or credit (prevents wrong-person mis-taps)
- Block deductions that would take a balance below zero
- Undo uses a reversing ledger entry, never deletes the original. Each entry can be undone only once, and a reversal itself cannot be undone. Every coin change needs a reason
- Make redemption cost more than the devil's deal pays, or participants can farm coins by looping
- Keep a fallback admin login in case OAuth fails on the day (built: `POST /api/auth/admin-fallback`, allowlisted email plus a shared passcode, off while no passcode is configured)
- Ownership and role checks on every service method, on top of the URL rule: admin-only operations need `ADMIN`, personal data (me, history, bids, events, refresh) needs the caller's own id, and bidding needs the PARTICIPANT role. Admin wallet buttons also check that the `adminId` is the signed-in admin
- A per-user token version on the server so a JWT can be revoked instantly (for example a cheater or compromised admin). The JWT filter rejects a stale version, and `POST /api/admin/users/{userId}/revoke-sessions` bumps it
- Keep the frontend free of pasted third-party scripts (the JWT lives in the browser, so XSS is the main risk); configure CORS to allow the `Authorization` header from the React origin
- Answers and hint passwords are never sent to a participant before they should see them

## 7. Time estimate

Backend: about 12 to 15 working days for one developer, or 1 to 1.5 weeks for two. Add about 30% if the team is new to Spring Boot.

Build order: auth, wallet, bidding, settlement and admin controls first (usable in 5 to 6 days). Then hints, corruption, devil's deal and pop-ups.

## 8. Open questions
- Exact coin prices, rewards, hint price and devil rates
- Tie-break and reserve-price details (current proposal in section 3)
- How the devil appears: each round, timed, or only on request
- Mystery assets (on hold)
- Number of problems per round (slots per problem will come from the auto slots rule). The number of rounds is 3
- Economy across 3 rounds: coins carry over and everyone pays for 3 problems per round, so starting coins and solve rewards must cover that

## 9. Origin
Based on the original "Hacker Auction" event document. The following were removed or changed from it: teams, live bidding, steal, open pool, dynamic pricing, in-app solving and in-app hint purchase.
