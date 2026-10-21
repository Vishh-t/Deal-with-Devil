# Deal with Devil: Backend Roadmap

Spring Boot 4.1.1 (Java 21), PostgreSQL in Docker (port 5433), React frontend.
Event: individual participants bid coins in a sealed multi-winner auction on HackerRank problems, with round-wide allocation and a three-win cap per participant. When the cap does not affect allocation, its price matches a Vickrey auction. Corruption levels change which hint version a participant gets, and the devil trades corruption for coins.

Tick the boxes as work is finished. Target for the whole backend: about 12 to 15 working days.

> Status 2026-10-20: the whole backend source was read against these docs and they match it. The full test suite (125 tests) passes, including `DealWithDevilCsaApplicationTests.contextLoads` against the Docker PostgreSQL 16, and the app starts normally. Still never exercised: a real Google sign-in, a dry-run with test accounts, and database behaviour in tests (row locks, unique constraints). The endpoint list and all request/response shapes are in `frontend-api-contract.md`.
>
> Update 2026-10-20 (later): ownership and role checks are now on every service method (see Phase 8), and `AccessGuardTest` (12 unit tests) was added. `CoinSafetyIntegrationTest` passes against the real PostgreSQL. 
>
> Update 2026-10-20 (latest): the integration tests were refactored onto the shared `IntegrationTestSupport` base class and `SettlementIntegrationTest` was added (ties, several slots, reserve price, unaffordable winner, settle clicked twice, simultaneous bids). All three integration test classes (`CoinSafetyIntegrationTest`, `RoundFlowIntegrationTest`, `SettlementIntegrationTest`) were run and all 43 integration tests pass (repeated tests count each repetition). A full `mvnw test` run now passes all 180 tests, the project compiles and the app starts normally. The 125-test figure above is the earlier count and is out of date.

> Update 2026-10-21: Phase 9 backend steps 1 to 11 are implemented, with `AllocationFlowIntegrationTest`, `CreditAllIntegrationTest` and unit tests for `SlotSpreader`, `AllocationCalculator` and `AutoFillPlanner`. In the current verification, all 188 selected non-database backend tests passed. A full `mvnw test` attempt could not connect to PostgreSQL at `localhost:5433`, so database integration and context-load tests still need to be run with PostgreSQL available. The frontend production build passes; lint completes with existing React warnings. `DDL_AUTO` is configurable (default `update`); the generated startup password is silenced. `frontend-api-contract.md` is the current API reference; the frontend spec PDF predates Phase 9.

---

## Phase 0: Setup (done)
- [x] Spring Boot project created (Web, Security, JPA, Validation, PostgreSQL, Lombok)
- [x] Maven and JDK 21 working in IntelliJ
- [x] PostgreSQL running in Docker on port 5433
- [x] `application.properties` with datasource and JPA settings
- [x] Time zone fix in `main` (Asia/Kolkata). Tests skip `main`, so `DealWithDevilCsaApplicationTests` sets the same zone in a static block
- [x] `.gitignore` updated, repo on GitHub

## Phase 1: Foundation (about 1 day)
- [x] Package structure: `config`, `domain`, `repository`, `web` (`controller`, `dto`, `handler`), `exception` created; `service` and `security` get created with their first class in Phases 2 and 3
- [x] Global exception handler and a standard error response (`ErrorResponse` in `web/dto`, `GlobalExceptionHandler` in `web/handler`; compiles)
- [x] Entities: `User` (includes `googleId`, `hackerRankId`), `Wallet`, `LedgerEntry` (coins are `long`; wallet has `@Version`; ledger is append-only; plus `Role` and `LedgerType` enums and the three repositories)
- [x] Config class for prices, rewards, preset amounts, devil rates (`GameProperties` bound from `game.*` in `application.properties`; values are placeholders until decided)
- [x] Health check endpoint (`/api/health`), plus a temporary `SecurityConfig` that permits it (replaced in Phase 2)

## Phase 2: Auth (about 1 day)
- [x] Add dependencies: `google-api-client` and a JWT library
- [x] `POST /api/auth/google`: verify the Google ID token (signature, audience, expiry, verified email)
- [x] `POST /api/auth/google` also finds or creates the user (email + Google id) and issues our own JWT (2 to 3 hours). The response includes `profileComplete`
- [x] Mandatory first-login profile form: `PUT /api/me/profile` takes name and HackerRank ID (trimmed, not blank, HackerRank ID unique, duplicate gives `CONFLICT` with the field in `details`). The same endpoint is used later if a participant needs to correct their HackerRank ID. Until `profileComplete` is true, every endpoint except `/api/me` and `/api/me/profile` returns `PROFILE_INCOMPLETE` (403); the frontend shows the form and lets them proceed once it is saved
- [x] Create the participant's wallet when the user is created
- [x] Admin panel shows each participant's HackerRank ID (backend side: `GET /api/admin/users` returns it)
- [x] JWT filter in the Spring Security chain (`Authorization: Bearer`)
- [x] `AuthenticationEntryPoint` (401) and `AccessDeniedHandler` (403) that return the same `ErrorResponse` JSON, because errors in the filter chain never reach `GlobalExceptionHandler`
- [x] Roles: PARTICIPANT and ADMIN (admin emails from an allowlist in config)
- [x] Fallback admin login for the event day (`POST /api/auth/admin-fallback`: allowlisted email plus a shared passcode from `ADMIN_FALLBACK_PASSCODE`; off while the passcode is blank; 5 failures per email in 5 minutes locks it out)
- [x] CORS for the React origin

## Phase 3: Wallet and ledger (about 2 days)
- [x] Integer coin balances; every change writes a `LedgerEntry` (admin, reason, amount, balance after) (`WalletService.applyTo` is the single chokepoint; reason required, zero amounts rejected)
- [x] Atomic credit and deduct with `@Transactional` and a balance check (`WalletService.credit` / `deduct`; wallet row is locked with `findByUserIdForUpdate`, balance below zero gives `INSUFFICIENT_BALANCE`)
- [x] Admin actions: preset credits (solved Bronze, Silver, Gold), generic hint deduction (participant and problem number), custom amount (`AdminWalletService`, `/api/admin/wallet/*`; each also writes the participant's pop-up event)
- [x] Undo by adding a reversing ledger entry (`WalletService.reverse`: an entry can be undone once, a reversal cannot be undone, `reversalOf` is unique in the database; admin endpoint `POST /api/admin/wallet/undo/{entryId}`, which also restores the corruption level when a devil entry is undone)
- [x] `GET /api/me` (coins, corruption level) and `GET /api/me/history`
- [x] Tests for the wallet logic (`WalletServiceTest`: Mockito unit tests, passing)

## Phase 4: Problems and round flow (about 2 days)
- [x] `Problem` entity: title, category, tier, slots, HackerRank link, base price
- [x] Hint versions: 3 per problem, one per corruption level, with passwords (admin only)
- [x] `Round` entity and phase state machine: Preview, Bidding, Settlement, Solving, Results (`RoundService`, `RoundServiceTest`)
- [x] Admin endpoints: start round, advance phase, pause, next round (plus resume, bidding deadline and settle)
- [x] Participant endpoints: current round and phase, problem preview (title, category, tier, teaser)

## Phase 5: Initial sealed bids and per-problem Vickrey settlement (about 2 to 3 days; allocation later superseded by Phase 9)
- [x] `Bid` entity: one bid per participant per problem, editable until the deadline
- [x] Server-side bidding deadline; reject late bids
- [x] Reject a bid above the participant's balance, and cap total bids at balance (also rejects a bid below the problem's reserve price)
- [x] Initial settlement: top k bidders win, all pay the (k+1)th highest bid, reserve price if too few bids, earlier bid wins ties (`VickreyCalculator`). Phase 9 replaces this per-problem allocation with the round-wide capped rule below.
- [x] Settlement deducts coins and writes ledger entries in one transaction (a winner who can no longer pay is marked UNAFFORDABLE; the slot is not reassigned)
- [x] Results endpoint: won or lost, price paid (`GET /api/me/bids`)
- [x] Thorough tests for settlement (ties, too few bids, insufficient balance): `VickreyCalculatorTest`, `SettlementServiceTest`, `BidServiceTest` (passing)

## Phase 6: Corruption and the devil (about 1 to 2 days)
- [x] Corruption level on the user (3 levels, up or down)
- [x] Devil's deal: coins up, level up (atomic, logged)
- [x] Redemption: coins down, level down (cost higher than the deal pays; the app refuses to start otherwise)
- [x] Block deals beyond the level limits
- [x] Hint lookup by problem and the participant's current level (admin sees which version and password to give)

## Phase 7: Feedback and leaderboard (about 1 to 2 days)
- [x] Event feed for pop-ups (bid won or lost, hint deducted, credits, level change), delivered by polling (`GET /api/me/events?after=`)
- [x] Leaderboard endpoint (by coins; equal coins share a rank)
- [x] Notifications for phase changes (broadcast events)

## Phase 8: Hardening and launch (about 2 to 3 days)
- [x] Audit log for every admin action (`AdminAuditFilter` records who called which state-changing `/api/admin/**` endpoint and the HTTP status; no request bodies; read it at `GET /api/admin/audit`; covered by `AdminAuditFilterTest` and `AuditServiceTest`, passing)
- [x] Ownership and role checks on every service method, in addition to the URL rule in `SecurityConfig` (`@EnableMethodSecurity` plus `@PreAuthorize`, using `AccessGuard` registered as `@guard`: `isSelf(id)`, `isAdmin()`, `isSelfOrAdmin(id)`). Admin-only: round, problem, settlement, wallet, ledger, audit, user-manager and winners methods, and `WalletService.credit/deduct/reverse`. Admin wallet buttons also require the `adminId` to be the caller (`hasRole('ADMIN') and @guard.isSelf(#adminId)`). Own-data-only: `UserService`, `WalletService.history`, `BidService.myBids` and `AuthService.refresh` (the user id must be the signed-in user's). Bidding needs the PARTICIPANT role and the caller's own id. Any signed-in user: current round, problem preview and leaderboard. Deliberately open: login methods, `AuditService.record` (the filter also logs refused participant calls) and the internal `EventService` writers (only called from admin-only services). A failed check returns `FORBIDDEN` (403) through `GlobalExceptionHandler`. `AccessGuardTest` covers the guard itself, and `CoinSafetyIntegrationTest` checks the annotations on the real beans
- [x] Input validation on every request body (Bean Validation with `@Valid` on every body; the one exception is the bidding deadline, a single optional date that `RoundService` checks must be in the future. Failures return `VALIDATION_FAILED` with per-field `details`. No automated test exercises these rules end to end yet)
- [ ] Optional rate limiting (only the backup admin sign-in is throttled today: 5 failures per email in 5 minutes, kept in memory, answered with `TOO_MANY_REQUESTS`. Nothing limits the other endpoints)
- [x] Token version for instant JWT revocation (the JWT filter rejects a stale `tokenVersion`; `POST /api/admin/users/{userId}/revoke-sessions` bumps it with one atomic update, `AdminUserService.revokeSessions`; the user can sign in again and gets a token with the new version. Covered by `CoinSafetyIntegrationTest`)
- [x] Narrow integration tests for the coin rules and access checks: `CoinSafetyIntegrationTest` (simultaneous bids cannot exceed the wallet, simultaneous undo clicks reverse an entry only once, `@PreAuthorize` enforced on the real services, 401/403 and revoked sessions over HTTP). Needs its own database once: `CREATE DATABASE deal_devil_test;` on the Docker Postgres (or set `TEST_DB_URL`); it never touches `deal_devil`. Passing (2026-10-20)
- [x] Event-day flow tests over HTTP: `RoundFlowIntegrationTest` (a whole round from start to results with settlement, coins, results, pop-ups, winners, ledger, leaderboard and audit; the bidding rules; devil's deal, redemption and undo; hint lookup by corruption level and hint purchase; the mandatory profile form; admin form validation). Same test database as above. Passing (2026-10-20). They stand in for most of the manual dry-run; still needed by hand: a real Google sign-in and the real frontend
- [x] Integration test clean-up and settlement tests (2026-10-20, all tests passing): `IntegrationTestSupport` is now the shared base class of all three integration test classes (the duplicated set-up and helpers were removed from `CoinSafetyIntegrationTest` and `RoundFlowIntegrationTest`), and the new `SettlementIntegrationTest` covers ties by submission time, several slots (bids 90/70/50/30 with k = 2), the reserve price floor, an unaffordable winner (slot not reassigned), settle clicked twice at the same moment (winner charged once) and two simultaneous bids over HTTP
- [x] Admin participant search (2026-10-20, written but NOT yet run): `GET /api/admin/users?q=text` returns the participants whose name or HackerRank ID contains the text (any letter case), so an admin can find the user id for the wallet buttons without knowing it. Without `q` it lists everyone as before. Test: `RoundFlowIntegrationTest.participantSearch_findsByNameOrHackerRankId_ignoringLetterCase`. Documented in `frontend-api-contract.md`
- [x] Question preview for bidders (2026-10-20, written but NOT yet run): `PUT /api/admin/problems/{id}/preview` (body `{"preview": "text"}`, max 4000 characters, blank removes it) attaches the question text participants read before bidding. It appears as `preview` in `GET /api/rounds/current/problems` (and in the admin problem responses); the HackerRank link is still never shown to bidders and only reaches the winner. Editable only while the round is in PREVIEW, like the other problem fields; the full-replace `PUT /api/admin/problems/{id}` leaves it alone. The new `problems.preview` column is added by `ddl-auto=update` (a migration is needed if you switch to `validate`). Tests: four new unit tests in `ProblemServiceTest` and extra checks in `RoundFlowIntegrationTest.fullRound_fromStartToResults`
- [ ] Configure deployment secrets outside the repository: `JWT_SECRET` is required and must be a cryptographically random value of at least 32 characters (the app fails to start if it is missing or too short); also set real `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `ADMIN_FALLBACK_PASSCODE` (if used), `DB_URL`, `DB_USERNAME`, and `DB_PASSWORD`. Do not rely on local development placeholders or database defaults on the server.
- [x] Switch `spring.jpa.hibernate.ddl-auto` from `update` to `validate` (or add migrations) before the event: now `${DDL_AUTO:update}`. On the event server create the tables once with `DDL_AUTO=update`, then run with `DDL_AUTO=validate`. Nothing else to do in code
- [x] Optional: silence the generated dev password Spring prints at startup (a `UserDetailsService` bean in `SecurityConfig` that never finds anybody; written 2026-10-21, not run yet)
- [ ] Optional: manual override of a settlement result (listed in the project context; there is no endpoint for it, only undo of coin entries and the corruption level editor)
- [ ] Deployment plan (server, database, HTTPS) and a dry-run with test accounts

## Phase 9: Exactly 3 problems per person (built 2026-10-21)
The original per-problem settlement did not cap wins per person. Phase 9 replaces it with a round-wide allocation and follow-up assignment flow. Every participant should finish each round with exactly 3 problems when available problems and balances permit. There are 3 contest rounds, each with its own problems, and one problem can go to several people in a round. Nobody can win the same problem twice, so no problem can have more slots than there are participants.

### Agreed design (2026-10-20)
Three pieces work together: auto slots (right number of slots), a global 3-win cap in settlement (nobody gets more than 3), and an auto fill after settlement (anyone short gets topped up).

**Assumptions the design relies on:** everyone bids on every problem (the bid screen must require it, or at least warn), no late sign-ups after the slots are set, and no admin coin deductions between bidding and settlement.

**Why the cap alone is not enough:** it stops anyone winning more than 3, but cannot force everyone up to 3. With exactly 3 x participants slots there is no margin, and in rare bidding patterns a leftover slot sits on a problem the short person already won (a person cannot win the same problem twice). Hence the auto fill step, plus manual assignment for whatever it cannot finish.

**Auto slots rule:** total slots = 3 x participants (N), spread evenly over the P problems of the round, the remainder giving one extra slot each, every problem clamped to at most N. By construction this always gives enough slots: with at least 3 problems, 3N / P is at most N, so the clamp never removes slots and the total is always exactly 3N (never below). Nobody hand-edits slots; the admin only presses this button, and presses it again whenever a new participant has signed in. The clamp stays only as a safety net. Example: 32 participants and 10 problems = 96 slots = 4 problems with 9 and 6 with 10. No extra surplus by default (a bigger surplus makes the guarantee stronger but pushes clearing prices towards the reserve and flattens the auction; keep it as a config value if wanted later).

**Global allocation (settlement):** take every eligible bid of the round (amount at or above the reserve), sort by amount, then earlier submission, then bid id. Walk the list and accept a bid only if the person has fewer than 3 wins and the problem still has a free slot. Price of a problem = the first bid rejected because the problem was full (not because the person was capped), else the reserve price. Equals today's Vickrey result whenever nobody would win more than 3. Bidding the true value is then close to, but not strictly, the best strategy (the cap links the problems).

**Auto fill (after settlement, proposed details to confirm):** for each person with fewer than 3 wins, give problems from the unsold slots at the reserve price, skipping problems they already hold. Handle the person with the fewest wins first (then by user id), and take the problem with the most unsold slots (then lower problem id) so the result is deterministic. If a person cannot afford the reserve price, or only problems they already hold have free slots, they stay flagged in the allocation view for manual assignment. Every fill writes a ledger entry and an audit entry and shows up in "my problems" like a normal win.

### Build order
- [ ] 0. Run the two written-but-not-run items (admin participant search, question preview) and commit, before starting Phase 9
- [x] 1. Config: `game.wins-per-round=3` in `GameProperties` (never hardcode 3)
- [x] 2. Auto slots endpoint: `POST /api/admin/rounds/current/slots/auto?dryRun=true|false`. Logic in `ProblemService` (it already owns the PREVIEW-only rule), route in `AdminRoundController`. Needs a participant count query (role PARTICIPANT, name and HackerRank ID not blank; `profileComplete` is computed in Java, so use JPQL). Errors with existing codes: `INVALID_PHASE` outside PREVIEW, `VALIDATION_FAILED` when N = 0 or P < 3. Response: N, P, slots needed, slots assigned and slots per problem. Unit test the pure spread function (50 participants and 7 problems = 3 x 22 and 4 x 21; 32 and 10 = 4 x 9 and 6 x 10; the clamp case) and one integration test for the phase rule. Safe to press again whenever someone new has signed in (the result depends only on the current counts); slots are not meant to be edited by hand
- [x] 3. `AllocationCalculator`: pure class like `VickreyCalculator`, no database. Unit tests: more than 3 wins, fewer than 3, ties, a problem with too few bids, equals the old `VickreyCalculator` when nobody exceeds the cap
- [x] 4. Rewire `SettlementService.settle()` onto it (one allocation for the whole round, winners still charged through `chargeWinner`). Fix `buildSummary`: it recomputes each problem's price with `VickreyCalculator`, which would be wrong after the change; read the stored `pricePaid` of the winners instead and the reserve price for problems without winners. Update `SettlementServiceTest` and `SettlementIntegrationTest` where a user would win more than 3, and add a cap integration test
- [x] 5. `BidService` cap: replace "sum of all bids at most balance" with "sum of the person's 3 highest bids at most balance". This also guarantees a winner can afford their wins (at most 3 wins, each at a price at or below the bid), so UNAFFORDABLE only happens if an admin deducts coins
- [x] 6. Block advancing PREVIEW to BIDDING in `RoundService` when total slots are below 3 x participants or the round has fewer than 3 problems (hard block, see decisions). Show the admin who has fewer than 3 bids before bidding closes
- [x] 7. Auto fill step after settlement (design above), plus an allocation view for the admin: every participant's win count, anyone not at exactly 3 flagged, unsold slots per problem
- [x] 8. Manual assignment: the admin gives a short person a specific problem (price: reserve price by default). Probably a `Bid` with status WON plus a ledger entry; check the unique constraint in `Bid.java` first. May need a new `LedgerType` for auto fill and manual assignment
- [x] 9. Integration tests for the whole flow (more than 3 wins, fewer than 3, total slots below and above 3 x participants, auto fill, manual assignment, double click on settle)
- [x] 10. Update `frontend-api-contract.md`, `hacker-auction-context_2.md` (done; the frontend build spec PDF is NOT updated, use the contract md for Phase 9 endpoints) Frontend: the bid screen should push people to bid on every problem
- [x] 11. Bulk wallet credit (economy across 3 rounds): `POST /api/admin/wallet/credit-all` with an amount and a required reason, credits every participant (role PARTICIPANT) the same number of coins in one transaction. It must go through `WalletService.credit` (never touch wallets directly), so every participant gets their own ledger entry with the admin id, the reason and the balance after, and their own pop-up event. The admin id must be the signed-in admin (same `@guard.isSelf(#adminId)` rule as the other wallet buttons). Confirm popup in the admin panel showing the amount and the number of participants. Guard against a double click crediting twice (for example an idempotency key or a short lock). A wrong run is undone entry by entry with the existing undo. People who sign up after the click do not get the coins, so run it after sign-ups close. Tests: every participant credited once with a ledger entry each, admins excluded, a non-admin is refused, double click credits once, amount must be positive

### Decisions
- [x] Slots are set only by the auto slots endpoint (3 x participants spread evenly); nobody hand-edits slots (decided 2026-10-20)
- [x] Cap at 3 wins per person inside settlement (global allocation), not just a flag
- [x] Fix shortfalls with an auto fill step after settlement, then manual assignment for the leftovers. A top-up auction is not planned
- [x] Price of an auto-filled or manually assigned problem = the reserve price (decided 2026-10-20)
- [x] Opening bidding is blocked when total slots are below 3 x participants (decided 2026-10-20). The auto slots rule always produces at least 3 x participants, so the block only fires when someone signed up after the button was pressed; the admin presses the button again and then opens bidding
- [x] Someone who never bids is not a problem: auto fill gives them their 3 problems at the reserve price (if they cannot afford it, they are flagged for manual assignment). Nobody is expected to skip bidding anyway (decided 2026-10-20)
- [x] Exactly 3 problems per person per round is a hard rule (decided 2026-10-20)
- [ ] Economy across 3 rounds: coins carry over and everyone pays for 3 problems per round, so starting coins and solve rewards must cover that or people run dry by round 2. Plan: the bulk wallet credit (step 11) lets the admin top everyone up between rounds. The amounts still need to be chosen

## Frontend (React), in parallel
- [ ] Google sign-in screen, token stored and sent as a Bearer header
- [ ] Participant app: dashboard, round preview, sealed bid screen, results pop-ups, my problems, leaderboard, rules
- [ ] Admin panel: round controls, problem manager, participant manager, preset buttons with confirm popups, ledger viewer

---

## Open decisions
- [ ] Coin prices, tier rewards, hint price, preset credit amounts (placeholders in `application.properties`: base price 50/100/200, solve reward 100/200/400, hint 30)
- [ ] Devil rates (coins per level; redemption must cost more than the deal pays; placeholders: the deal pays 100, redemption costs 150)
- [ ] Reserve price rule and tie-break details (implemented as: reserve = the problem's base price, bids below it are rejected, the earlier bid wins a tie; confirm with the organisers)
- [ ] Slots per problem, number of rounds, problems per round
- [ ] How the devil appears (every round, timed, or on request)
- [x] How long the event runs: handled either way. The JWT lasts 3 hours (`app.auth.jwt-expiry-hours`) and `POST /api/auth/refresh` gives a fresh one, so a long event needs no new Google sign-in
- [ ] Mystery assets (on hold)
- [x] HackerRank ID: participants can edit it themselves (decided)
- [ ] Do admins need a HackerRank ID too? (for now the profile gate only applies to participants)
- [x] Real admin emails (15 tech team members), the real Google OAuth client ID and a real JWT secret: set as the environment variables `ADMIN_EMAILS`, `GOOGLE_CLIENT_ID` and `JWT_SECRET` (kept out of the repo)
- [ ] Google Cloud: set the OAuth consent screen (Audience) to In production so non-test users can sign in; add the real React origin to Authorized JavaScript origins once deployed
- [ ] Phase 2: test login end to end with a real Google token (OAuth client and environment variables are now set up, but no real login has been tried yet)

## Suggested order
Phases 1 to 3 give a working login and wallet, then phases 4 and 5 make the core auction usable. Phases 6 and 7 add the extras. Phase 8 comes before the event, not after.
