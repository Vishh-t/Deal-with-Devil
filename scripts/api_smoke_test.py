#!/usr/bin/env python3
"""
Deal with Devil: API smoke test against a RUNNING backend. Python 3.8+, standard library only.

What it can and cannot automate
  Google's sign-in screen needs a human, so the script cannot sign in to Google by itself. You give it a fresh Google
  ID token once (see "Getting an ID token" below) and it does everything else: login, profile gate, roles, refresh,
  bad tokens, and, with --full-round, a whole auction round from start to results.

Setup (PowerShell example, backend already running on port 8080)
  $env:ADMIN_EMAIL = "you@gmail.com"                 # an address that is in ADMIN_EMAILS on the backend
  $env:ADMIN_FALLBACK_PASSCODE = "the passcode"      # same value the backend has; gives an admin token with no Google
  $env:PARTICIPANT_ID_TOKEN = "<google id_token>"    # of a Google account that is NOT in ADMIN_EMAILS
  python scripts/api_smoke_test.py                   # safe checks
  python scripts/api_smoke_test.py --full-round      # also runs a whole round (see warning)

  Optional: BASE_URL (default http://localhost:8080), ADMIN_ID_TOKEN (admin sign-in through Google instead of the
  fallback passcode), PARTICIPANT_NAME and PARTICIPANT_HR_ID (used if the profile form still has to be filled).

Getting an ID token
  Postman: Authorization tab, OAuth 2.0, Authorization Code, Auth URL https://accounts.google.com/o/oauth2/v2/auth,
  Access Token URL https://oauth2.googleapis.com/token, scope "openid email profile", your client id and secret,
  callback https://oauth.pstmn.io/v1/callback. Copy the id_token (not the access token). It lasts about an hour.

WARNING
  The safe mode only reads, plus one profile save if the profile is still empty. --full-round WRITES to the database:
  it starts a new round, creates 3 problems, credits 1000 coins to the test participant, bids, settles, and runs
  credit-all (which credits EVERY participant). Use a database you can throw away. It refuses to start if the latest
  round is not finished. On an empty database it simply begins at round 1.

Exit code 0 = every check passed, 1 = at least one failed, 2 = the backend could not be reached.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSCODE = os.environ.get("ADMIN_FALLBACK_PASSCODE", "")
ADMIN_ID_TOKEN = os.environ.get("ADMIN_ID_TOKEN", "")
PARTICIPANT_ID_TOKEN = os.environ.get("PARTICIPANT_ID_TOKEN", "")
PARTICIPANT_NAME = os.environ.get("PARTICIPANT_NAME", "Smoke Test")
PARTICIPANT_HR_ID = os.environ.get("PARTICIPANT_HR_ID", "smoke_test_" + uuid.uuid4().hex[:6])
FULL_ROUND = "--full-round" in sys.argv

results = []


def call(method, path, token=None, body=None):
    """Returns (http status, parsed json or None)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, (json.loads(raw) if raw else None)
        except ValueError:
            return e.code, {"raw": raw}
    except urllib.error.URLError as e:
        print("\nCannot reach %s (%s). Is the backend running?" % (BASE, e.reason))
        sys.exit(2)


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print("  [%s] %s%s" % ("PASS" if ok else "FAIL", name, ("  -> " + str(detail)) if (detail and not ok) else ""))
    return ok


def code_of(body):
    return body.get("code") if isinstance(body, dict) else None


def section(title):
    print("\n== " + title)


# ------------------------------------------------------------------ safe checks

def basics():
    section("Basics and bad tokens")
    st, body = call("GET", "/api/health")
    check("health is UP", st == 200 and body and body.get("status") == "UP", (st, body))

    st, body = call("GET", "/api/me")
    check("no token gives 401", st == 401, (st, body))

    st, body = call("GET", "/api/me", token="not.a.jwt")
    check("garbage bearer token gives 401", st == 401, (st, body))

    st, body = call("POST", "/api/auth/google", body={"idToken": "garbage"})
    check("garbage Google token gives 401 INVALID_GOOGLE_TOKEN", st == 401 and code_of(body) == "INVALID_GOOGLE_TOKEN", (st, body))

    st, body = call("POST", "/api/auth/google", body={})
    check("missing idToken gives 400 VALIDATION_FAILED", st == 400 and code_of(body) == "VALIDATION_FAILED", (st, body))


def admin_login():
    section("Admin sign-in")
    token = None
    if ADMIN_ID_TOKEN:
        st, body = call("POST", "/api/auth/google", body={"idToken": ADMIN_ID_TOKEN})
        if check("admin Google login works and role is ADMIN", st == 200 and body and body.get("role") == "ADMIN", (st, body)):
            token = body["token"]
    if ADMIN_EMAIL and ADMIN_PASSCODE:
        st, body = call("POST", "/api/auth/admin-fallback", body={"email": ADMIN_EMAIL, "passcode": "definitely-wrong-passcode"})
        check("fallback admin with a wrong passcode is refused (401)", st == 401, (st, body))
        st, body = call("POST", "/api/auth/admin-fallback", body={"email": ADMIN_EMAIL, "passcode": ADMIN_PASSCODE})
        if check("fallback admin login works and role is ADMIN", st == 200 and body and body.get("role") == "ADMIN", (st, body)) and not token:
            token = body["token"]
    if not token:
        print("  (no admin token: set ADMIN_EMAIL and ADMIN_FALLBACK_PASSCODE, or ADMIN_ID_TOKEN. Admin checks skipped)")
    return token


def participant_login():
    section("Participant sign-in")
    if not PARTICIPANT_ID_TOKEN:
        print("  (PARTICIPANT_ID_TOKEN not set: participant checks skipped)")
        return None, None
    st, body = call("POST", "/api/auth/google", body={"idToken": PARTICIPANT_ID_TOKEN})
    if not check("participant Google login works (200)", st == 200 and body and body.get("token"), (st, body)):
        print("      The ID token may have expired (about 1 hour) or GOOGLE_CLIENT_ID does not match the token.")
        return None, None
    check("role is PARTICIPANT (the email must not be in ADMIN_EMAILS)", body.get("role") == "PARTICIPANT", body)
    token = body["token"]

    st, me = call("GET", "/api/me", token)
    check("GET /api/me returns the user", st == 200 and me and me.get("email"), (st, me))
    if st != 200:
        return None, None
    check("user has a wallet and a corruption level of at least 1", me.get("corruptionLevel", 0) >= 1 and "coins" in me, me)

    if not me.get("profileComplete"):
        st, body = call("GET", "/api/rounds/current", token)
        check("profile gate: other endpoints give 403 PROFILE_INCOMPLETE", st == 403 and code_of(body) == "PROFILE_INCOMPLETE", (st, body))

    st, body = call("PUT", "/api/me/profile", token, {"name": "   ", "hackerRankId": ""})
    check("profile form rejects blank fields (400 VALIDATION_FAILED)", st == 400 and code_of(body) == "VALIDATION_FAILED", (st, body))

    if not me.get("profileComplete"):
        st, body = call("PUT", "/api/me/profile", token, {"name": PARTICIPANT_NAME, "hackerRankId": PARTICIPANT_HR_ID})
        check("profile form saves (200) and profileComplete is true", st == 200 and body and body.get("profileComplete") is True, (st, body))
        st, me = call("GET", "/api/me", token)

    # Signing in again must find the same user, not create a duplicate.
    st, again = call("POST", "/api/auth/google", body={"idToken": PARTICIPANT_ID_TOKEN})
    if st == 200:
        st2, me2 = call("GET", "/api/me", again["token"])
        check("signing in twice gives the same user (no duplicate)", st2 == 200 and me2.get("id") == me.get("id"), (me, me2))
    else:
        check("second login with the same ID token works", False, (st, again))

    st, body = call("POST", "/api/auth/refresh", token)
    check("refresh gives a new token", st == 200 and body and body.get("token"), (st, body))

    tampered = token[:-3] + ("AAA" if not token.endswith("AAA") else "BBB")
    st, body = call("GET", "/api/me", tampered)
    check("tampered JWT is refused (401)", st == 401, (st, body))

    st, body = call("GET", "/api/config", token)
    ok = st == 200 and body and body["devil"]["redemptionCost"] > body["devil"]["dealPayout"]
    check("config loads and redemption costs more than the devil's deal pays", ok, (st, body))

    for path in ("/api/leaderboard", "/api/me/history", "/api/me/events", "/api/me/bids"):
        st, body = call("GET", path, token)
        check("participant can read " + path, st == 200, (st, body))

    for path in ("/api/admin/users", "/api/admin/ledger", "/api/admin/audit", "/api/admin/rounds/current/bid-coverage"):
        st, body = call("GET", path, token)
        check("participant is refused on " + path + " (403)", st == 403, (st, body))
    st, body = call("POST", "/api/admin/wallet/credit-all", token,
                    {"amount": 10, "reason": "should not work", "requestId": "smoke-" + uuid.uuid4().hex})
    check("participant cannot press Credit everyone (403)", st == 403, (st, body))
    st, body = call("POST", "/api/admin/rounds/current/slots/auto?dryRun=true", token)
    check("participant cannot press Auto slots (403)", st == 403, (st, body))
    return token, me


def admin_reads(admin_token, me):
    section("Admin reads")
    st, users = call("GET", "/api/admin/users", admin_token)
    check("admin can list participants", st == 200 and isinstance(users, list), (st, users))
    if me and st == 200:
        check("the test participant appears in the admin list", any(u.get("id") == me["id"] for u in users), "not found")
        q = (me.get("name") or "")[:3]
        if q:
            st, found = call("GET", "/api/admin/users?q=" + urllib.parse.quote(q), admin_token)
            check("participant search finds them by part of the name",
                  st == 200 and any(u.get("id") == me["id"] for u in found), (st, found))
    st, body = call("GET", "/api/admin/audit", admin_token)
    check("admin can read the audit log", st == 200 and isinstance(body, list), (st, body))
    st, body = call("GET", "/api/admin/ledger", admin_token)
    check("admin can read the ledger", st == 200 and isinstance(body, list), (st, body))
    st, body = call("POST", "/api/admin/rounds/current/slots/auto", admin_token)
    check("auto slots without dryRun is a 400 (the parameter is required)", st == 400, (st, body))
    st, body = call("POST", "/api/admin/wallet/credit-all", admin_token,
                    {"amount": 0, "reason": "bad", "requestId": "smoke-" + uuid.uuid4().hex})
    check("credit-all rejects amount 0 (400)", st == 400, (st, body))


# ------------------------------------------------------------------ full round

def full_round(admin, ptoken, me):
    section("FULL ROUND (writes to the database)")
    st, rnd = call("GET", "/api/rounds/current", admin)
    if st == 200 and rnd.get("phase") != "RESULTS":
        print("  Latest round %s is in phase %s. Finish it (or use an empty database) first. Aborting."
              % (rnd.get("number"), rnd.get("phase")))
        results.append(False)
        return
    st, rnd = call("POST", "/api/admin/rounds", admin)
    if not check("admin starts a new round (201, phase PREVIEW)", st == 201 and rnd.get("phase") == "PREVIEW", (st, rnd)):
        return
    rid = rnd["id"]

    ids = []
    prob = None
    for i, title in enumerate(("Smoke A", "Smoke B", "Smoke C")):
        st, prob = call("POST", "/api/admin/problems", admin, {
            "title": title, "category": "Smoke", "tier": "BRONZE", "slots": 1,
            "hackerRankLink": "https://example.com/smoke-" + str(i), "roundId": rid})
        if not check("admin creates problem " + title, st == 201, (st, prob)):
            return
        ids.append(prob["id"])
    reserve = prob["basePrice"]

    st, dry = call("POST", "/api/admin/rounds/current/slots/auto?dryRun=true", admin)
    ok = st == 200 and dry["slotsNeeded"] == 3 * dry["participants"] and dry["slotsAssigned"] == dry["slotsNeeded"]
    check("auto slots dry run: slots needed = 3 x participants", ok, (st, dry))
    if st != 200:
        return
    participants = dry["participants"]

    if participants > 1:
        # Each problem has 1 slot (3 in total), but 3 x participants are needed, so bidding must not open yet.
        st, body = call("POST", "/api/admin/rounds/current/advance", admin)
        check("opening bidding with too few slots is refused (409 INVALID_PHASE)",
              st == 409 and code_of(body) == "INVALID_PHASE", (st, body))
    else:
        print("  (only one participant exists, so 3 default slots already suffice: the 'too few slots' check is skipped)")

    st, applied = call("POST", "/api/admin/rounds/current/slots/auto?dryRun=false", admin)
    check("auto slots applied", st == 200 and applied["dryRun"] is False, (st, applied))

    st, body = call("POST", "/api/admin/wallet/custom", admin,
                    {"userId": me["id"], "amount": 1000, "reason": "smoke test coins"})
    check("admin credits the test participant 1000 coins", st == 200 and body["amount"] == 1000, (st, body))
    st, before = call("GET", "/api/me", ptoken)
    coins_before = before["coins"]

    st, body = call("POST", "/api/admin/rounds/current/advance", admin)
    check("bidding opens (phase BIDDING)", st == 200 and body["phase"] == "BIDDING", (st, body))

    st, body = call("PUT", "/api/rounds/current/problems/%d/bid" % ids[0], ptoken, {"amount": max(1, reserve - 1)})
    check("bid below the reserve price is refused (400)", st == 400 and code_of(body) == "VALIDATION_FAILED", (st, body))
    st, body = call("PUT", "/api/rounds/current/problems/%d/bid" % ids[0], ptoken, {"amount": coins_before + 10_000_000})
    check("bid above the balance is refused (409 BID_EXCEEDS_BALANCE)", st == 409 and code_of(body) == "BID_EXCEEDS_BALANCE", (st, body))
    st, body = call("PUT", "/api/rounds/current/problems/%d/bid" % ids[0], admin, {"amount": reserve})
    check("an admin cannot bid (403)", st == 403, (st, body))

    for pid, amount in zip(ids, (reserve + 30, reserve + 20, reserve + 10)):
        st, body = call("PUT", "/api/rounds/current/problems/%d/bid" % pid, ptoken, {"amount": amount})
        check("participant bids %d on problem %d" % (amount, pid), st == 200 and body["status"] == "PENDING", (st, body))
    st, bids = call("GET", "/api/me/bids", ptoken)
    check("participant sees their 3 bids, all PENDING, no link yet",
          st == 200 and len(bids) == 3 and all(b["status"] == "PENDING" and not b.get("hackerRankLink") for b in bids), (st, bids))

    st, cov = call("GET", "/api/admin/rounds/current/bid-coverage", admin)
    row = next((p for p in cov["participants"] if p["userId"] == me["id"]), None) if st == 200 else None
    check("bid coverage shows the participant with 3 bids and none missing",
          row is not None and row["bidCount"] == 3 and row["missingBids"] == 0, (st, cov))

    st, body = call("POST", "/api/admin/rounds/current/advance", admin)
    check("bidding closes (phase SETTLEMENT)", st == 200 and body["phase"] == "SETTLEMENT", (st, body))
    st, body = call("PUT", "/api/rounds/current/problems/%d/bid" % ids[0], ptoken, {"amount": reserve + 1})
    check("late bid is refused (409 BIDDING_CLOSED)", st == 409 and code_of(body) == "BIDDING_CLOSED", (st, body))
    st, body = call("POST", "/api/admin/rounds/current/auto-fill?dryRun=true", admin)
    check("auto fill before settlement is refused (409 INVALID_PHASE)", st == 409 and code_of(body) == "INVALID_PHASE", (st, body))

    st, summ = call("POST", "/api/admin/rounds/current/settle", admin)
    check("settlement runs (200)", st == 200 and len(summ["problems"]) == 3, (st, summ))
    st, body = call("POST", "/api/admin/rounds/current/settle", admin)
    check("settling twice is refused (409 ALREADY_SETTLED)", st == 409 and code_of(body) == "ALREADY_SETTLED", (st, body))

    st, bids = call("GET", "/api/me/bids", ptoken)
    won = [b for b in bids if b["status"] == "WON"] if st == 200 else []
    check("participant won all 3 problems, with links and a price at or above the reserve",
          len(won) == 3 and all(b.get("hackerRankLink") and b["pricePaid"] >= reserve for b in won), (st, bids))
    st, after = call("GET", "/api/me", ptoken)
    paid = sum(b["pricePaid"] for b in won)
    check("coins went down by exactly what was paid", after["coins"] == coins_before - paid,
          (coins_before, paid, after.get("coins")))

    st, alloc = call("GET", "/api/admin/rounds/current/allocation", admin)
    mine = next((p for p in alloc["participants"] if p["userId"] == me["id"]), None) if st == 200 else None
    check("allocation view shows the participant at exactly 3", mine is not None and mine["wins"] == 3 and mine["atTarget"], (st, mine))
    st, fill = call("POST", "/api/admin/rounds/current/auto-fill?dryRun=true", admin)
    check("auto fill dry run works and gives the test participant nothing more",
          st == 200 and fill["dryRun"] is True and not any(a["userId"] == me["id"] for a in fill["assignments"]), (st, fill))
    if st == 200 and (fill["assignments"] or fill["stillShort"]):
        print("      Note: %d assignment(s) planned for other participants, %d still short (normal if they did not bid)."
              % (len(fill["assignments"]), len(fill["stillShort"])))

    request_id = "smoke-" + uuid.uuid4().hex
    credit_body = {"amount": 5, "reason": "smoke test credit everyone", "requestId": request_id}
    st, credit = call("POST", "/api/admin/wallet/credit-all", admin, credit_body)
    check("credit-all works (200)", st == 200 and credit["amountEach"] == 5, (st, credit))
    st, again = call("POST", "/api/admin/wallet/credit-all", admin, credit_body)
    check("same requestId again is refused (409), nobody credited twice", st == 409 and code_of(again) == "CONFLICT", (st, again))
    st, final = call("GET", "/api/me", ptoken)
    check("participant got the 5 coins exactly once", final["coins"] == after["coins"] + 5, (after["coins"], final.get("coins")))

    st, events = call("GET", "/api/me/events", ptoken)
    types = {e["type"] for e in events} if st == 200 else set()
    check("participant got BID_WON and CUSTOM_ADJUSTMENT pop-ups", {"BID_WON", "CUSTOM_ADJUSTMENT"} <= types, types)

    st, rnd = call("POST", "/api/admin/rounds/current/advance", admin)
    check("round moves from SOLVING to RESULTS", st == 200 and rnd["phase"] == "RESULTS", (st, rnd))
    st, board = call("GET", "/api/leaderboard", ptoken)
    check("leaderboard lists the participant", st == 200 and any(e["userId"] == me["id"] for e in board), (st, board))
    st, audit = call("GET", "/api/admin/audit?limit=50", admin)
    check("audit log recorded the settlement", st == 200 and any("/settle" in a["path"] for a in audit), (st, audit))


def main():
    print("Deal with Devil API smoke test against " + BASE + (" (FULL ROUND)" if FULL_ROUND else ""))
    basics()
    admin = admin_login()
    ptoken, me = participant_login()
    if admin:
        admin_reads(admin, me)
    if FULL_ROUND:
        if admin and ptoken and me:
            full_round(admin, ptoken, me)
        else:
            print("\n--full-round needs both an admin token and a participant token. Skipped.")
            results.append(False)

    passed = sum(1 for r in results if r)
    print("\n%d passed, %d failed" % (passed, len(results) - passed))
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
