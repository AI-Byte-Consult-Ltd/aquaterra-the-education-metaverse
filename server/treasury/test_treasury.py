"""End-to-end test of public finance on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/treasury/test_treasury.py

Loads the account fixture, the Tide economy (ECONOMY_SQL, default the project
copy), the Commonwealth, travel, the Arcade and treasury.sql (twice: the
migration must be safe to run again), then plays salaries, taxes, debts,
auctions, the bank and the Founder's loan.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ARC = os.path.join(ROOT, "server", "arcade")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_treasury_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]


def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db, "-c", sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {sql[:300]}\n{r.stderr}")
    return r.stdout.strip()


def load(f):
    r = subprocess.run(BASE + ["-d", DB, "-f", f], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{f}: {r.stderr}")


lit = lambda s: "'" + s.replace("'", "''") + "'"
J = lambda sql: json.loads(psql(sql))
passed = 0


def check(cond, msg):
    global passed
    if not cond:
        raise SystemExit("FAIL: " + msg)
    passed += 1


psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")
psql(f"CREATE DATABASE {DB}", db="postgres")
load(os.path.join(GOV, "base-tables.sql"))
load(ECONOMY)
for f in ["schema.sql", "functions.sql", "api.sql"]:
    load(os.path.join(GOV, f))
load(os.path.join(ROOT, "server", "travel", "travel.sql"))
for f in ["schema.sql", "bank.sql", "functions.sql", "api.sql"]:
    load(os.path.join(ARC, f))
load(os.path.join(ROOT, "server", "exchange", "exchange.sql"))
load(os.path.join(ROOT, "server", "build", "build.sql"))

S, EMAIL = {}, {}


def player(email, name, role="citizen", tide=0):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account, balance) VALUES ({lit(email)}, {tide}) ON CONFLICT (account) DO UPDATE SET balance = {tide}")
    S[name], EMAIL[name] = tok, email


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def bank(name, **kw):
    req = dict(kw, session=S[name]) if name else dict(kw)
    return J(f"SELECT aquaterra_bank({lit(json.dumps(req))}::jsonb)")


def plot(pid, price, owner=None, days_ago=10):
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, 'Lot {pid}', 'First Light City', 4, {price}) ON CONFLICT DO NOTHING")
    if owner:
        psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid, bought_at, income_from) VALUES ({pid}, {lit(EMAIL[owner])}, {price}, now() - interval '{days_ago} days', now())")


def tick():
    psql("SELECT aquaterra_fisc_tick()")


def new_day():
    psql("DELETE FROM aquaterra_fisc_runs WHERE kind IN ('payroll', 'bank', 'civic')")


def law(key):
    return float(psql(f"SELECT value FROM aquaterra_gov_params WHERE key = {lit(key)}"))


player("info@aibyteconsult.com", "Alexander", "founder")
player("ava@x", "Ava", tide=30)
player("ben@x", "Ben", tide=5000)
player("cleo@x", "Cleo", tide=8000)
psql("INSERT INTO aquaterra_council (seat, name, title, kind, email) VALUES (1, 'Alexander', 'Founder', 'human', 'info@aibyteconsult.com'), (2, 'NICS AI', 'City Mind', 'ai', NULL)")
plot(1, 2400, "Alexander", 3)
plot(2, 400, "Alexander", 3)
psql("UPDATE aquaterra_gov_params SET value = 5 WHERE key = 'arcade_prize_tax_pct'")

for _ in range(2):
    load(os.path.join(HERE, "treasury.sql"))

# --- founding: bank capital and the Founder's loan, once
check(bal("bank:first-light") == 1000000 - 50000, "bank holds 1,000,000 capital minus the founder loan")
check(bal("info@aibyteconsult.com") == 50000, "Founder received 50,000 TIDE")
fl = J("SELECT aquaterra_loan_json(l) FROM aquaterra_bank_loans l WHERE kind = 'founder'")
check(fl["outstanding"] == 50000 and fl["ratePct"] == 0 and fl["repayPct"] == 10 and fl["plotId"] == 1, f"founder loan terms: {fl}")
check(psql("SELECT count(*) FROM aquaterra_gov_log WHERE kind = 'loan'") == "1", "founder loan in the state journal once")
check(law("arcade_prize_tax_pct") == 10 and law("rent_tax_pct") == 10, "prize and rent taxes raised to 10%")
check(psql("SELECT count(*) FROM aquaterra_gov_params WHERE key = 'land_tax_pct'") == "0", "old yearly land tax law removed")
check("income_tax_pct" in psql("SELECT prosrc FROM pg_proc WHERE proname = 'aquaterra_gov_nics_ai'"), "NICS rule E1 covers income tax")
check(psql("SELECT aquaterra_name('bank:first-light')") == "Bank of First Light", "bank wallet has a name")
check(psql("SELECT aquaterra_name('market:escrow')") == "Tide Market", "names of other workflows stay")

# --- salaries: from the State Treasury, 10% tax, 10% to the founder loan
psql("UPDATE aquaterra_wallets SET balance = 1000 WHERE account = 'state:treasury'")
tick()
check(bal("info@aibyteconsult.com") == 50000 + 50 - 5 - 5 - 1, "Founder salary 50, tax 5, loan 5, weekly land tax 1 on his second plot")
check(bal("nics-ai") == 50, "NICS AI share 50 in its fund")
check(bal("state:treasury") == 1000 - 100 + 5 + 1, "treasury paid 100 and got 5 income tax and 1 land tax")
check(J("SELECT aquaterra_loan_json(l) FROM aquaterra_bank_loans l WHERE kind = 'founder'")["outstanding"] == 49995, "loan repaid by 5")
tick()
check(bal("info@aibyteconsult.com") == 50039, "salary paid once a day")
psql("UPDATE aquaterra_gov_directorate SET holder_email = 'ben@x', term_ends = now() + interval '90 days' WHERE post = 'treasury'")
psql("INSERT INTO aquaterra_districts (id, name, biome, land) VALUES (99, 'Testville', 'temperate', 'main') ON CONFLICT DO NOTHING")
psql("UPDATE aquaterra_districts SET mayor_email = 'ben@x', mayor_term_ends = now() + interval '90 days' WHERE id = 99")
new_day(); tick()
check(bal("ben@x") == 5000 + 40 - 4, "Director and Mayor: only the best salary, 40 minus tax")
psql("UPDATE aquaterra_gov_directorate SET holder_email = NULL, term_ends = NULL; UPDATE aquaterra_districts SET mayor_email = NULL WHERE id = 99")
psql("UPDATE aquaterra_wallets SET balance = 10 WHERE account = 'state:treasury'")
new_day(); tick()
check(psql("SELECT unpaid FROM aquaterra_fisc_runs WHERE kind = 'payroll' ORDER BY at DESC LIMIT 1") != "0", "empty treasury: salaries not paid, counted")
check(psql("SELECT count(*) FROM aquaterra_notices WHERE kind = 'salary'") != "0", "office holders are told")
psql("UPDATE aquaterra_wallets SET balance = 100000 WHERE account = 'state:treasury'")

# --- land income: 10% income tax and 10% of it repays the founder loan
J(f"SELECT aquaterra_economy({lit(json.dumps({'action': 'wallet', 'session': S['Alexander']}))}::jsonb)")  # welcome grant first
psql("UPDATE aquaterra_plot_owners SET income_from = now() - interval '1 day' WHERE owner = 'info@aibyteconsult.com'")
before, tr = bal("info@aibyteconsult.com"), bal("state:treasury")
r = J(f"SELECT aquaterra_economy({lit(json.dumps({'action': 'claim', 'session': S['Alexander']}))}::jsonb)")
check(r["ok"], f"claim works: {r}")
gross = 28  # 1% a day of 2,800
check(bal("info@aibyteconsult.com") - before == gross - 3 - 3, f"claim {gross}: tax 3, loan 3 ({bal('info@aibyteconsult.com') - before})")
check(bal("state:treasury") - tr == 3, "income tax to the treasury")

# --- deal duty on plot purchases, paid by the buyer
plot(10, 1000)
plot(11, 500)
tr = bal("state:treasury")
psql("SELECT aquaterra_move('ben@x', 'treasury', 1000, 'plot_purchase', 10, 'Lot 10', 'ben@x')")
psql("INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (10, 'ben@x', 1000)")
check(bal("state:treasury") - tr == 20, "2% duty on a 1,000 plot")
psql("UPDATE aquaterra_wallets SET balance = 500 WHERE account = 'ava@x'")
try:
    psql("SELECT aquaterra_move('ava@x', 'treasury', 500, 'plot_purchase', 11, 'Lot 11', 'ava@x')")
    check(False, "buying with no TIDE for the duty must fail")
except SystemExit as e:
    check("insufficient" in str(e), "no coins for the duty: purchase refused")
psql("UPDATE aquaterra_wallets SET balance = 0 WHERE account = 'ava@x'")

# --- weekly land tax: the first plot is free, unpaid tax becomes a debt
plot(20, 400, "Ava", 20)
plot(21, 5000, "Ava", 20)
psql("DELETE FROM aquaterra_fisc_runs WHERE kind = 'land_tax'; DELETE FROM aquaterra_debts")  # a new week
tick()
d = J("SELECT row_to_json(d) FROM aquaterra_debts d WHERE email = 'ava@x'")
check(d["amount"] == 10 and d["paid"] == 0 and d["status"] == "open", f"Ava: first plot free, 0.2% of 5,000 = 10 owed: {d}")
alex = J(f"SELECT aquaterra_bank_me('info@aibyteconsult.com')")
check([p["weeklyTax"] for p in alex["plots"]] == [0, 1], f"Founder: first plot free, 0.2% of 400 rounds to 1: {alex['plots']}")
check(psql("SELECT count(*) FROM aquaterra_fisc_runs WHERE kind = 'land_tax'") == "1", "land tax runs once a week")
tick()
check(psql("SELECT count(*) FROM aquaterra_debts WHERE email = 'ava@x'") == "1", "no second land tax the same week")
me = bank("Ava", action="me")
check(len(me["debts"]) == 1 and any(n["kind"] == "debt" for n in me["notices"]), "Ava sees the debt and a notice")
psql("UPDATE aquaterra_debts SET created_at = now() - interval '7 days' WHERE email = 'ava@x'")
tick()
check(psql("SELECT reminded_day FROM aquaterra_debts WHERE email = 'ava@x'") == "7", "reminder on day 7")
psql("UPDATE aquaterra_debts SET created_at = now() - interval '14 days' WHERE email = 'ava@x'")
tick()
check(psql("SELECT amount, penalized FROM aquaterra_debts WHERE email = 'ava@x'") == "11|t", "after 14 days a 5% penalty (min 1)")
check(bank("Ava", action="pay_debts")["error"] == "insufficient", "nothing to pay with")
check(bank("Ava", action="borrow", plotId=20, amount=100)["error"] == "debt", "no loan while in debt")
psql("UPDATE aquaterra_debts SET created_at = now() - interval '31 days' WHERE email = 'ava@x'")
tick()
au = J("SELECT row_to_json(a) FROM aquaterra_land_auctions a WHERE status = 'open'")
check(au["plot_id"] == 21 and au["owed"] == 11 and au["min_bid"] == 2500, f"after 30 days the dearest plot goes to auction: {au}")
check(psql("SELECT status FROM aquaterra_debts WHERE email = 'ava@x'") == "auction", "debt waits for the auction")

# --- the auction: bids held with the duty, outbid refunded, winner takes the plot
check(bank("Ava", action="bid", auctionId=au["id"], amount=3000)["error"] == "self", "owner cannot bid")
check(bank("Ben", action="bid", auctionId=au["id"], amount=2000)["error"] == "low_bid", "below the starting bid")
b0 = bal("ben@x")
check(bank("Ben", action="bid", auctionId=au["id"], amount=2500)["ok"], "Ben bids 2,500")
check(b0 - bal("ben@x") == 2550, "bid and 2% duty held")
check(bank("Cleo", action="bid", auctionId=au["id"], amount=2510)["error"] == "low_bid", "must beat the best bid by 1%")
check(bank("Cleo", action="bid", auctionId=au["id"], amount=2600)["ok"], "Cleo bids 2,600")
check(bal("ben@x") == b0, "Ben got bid and duty back")
tr, ava = bal("state:treasury"), bal("ava@x")
psql("UPDATE aquaterra_land_auctions SET ends_at = now() - interval '1 minute' WHERE status = 'open'")
tick()
check(psql("SELECT owner FROM aquaterra_plot_owners WHERE plot_id = 21") == "cleo@x", "Cleo owns the plot")
check(bal("ava@x") - ava == 2600 - 11, "Ava gets the price minus the debt")
check(bal("state:treasury") - tr == 11 + 52, "treasury gets the debt and the duty")
check(psql("SELECT status FROM aquaterra_debts WHERE email = 'ava@x'") == "settled", "debt settled")
check(bal("state:escrow") == 0, "auction escrow is empty")

# --- the bank: deposits with interest, loans against a plot
check(bank("Ben", action="deposit", amount=999999)["error"] == "insufficient", "cannot deposit more than you have")
r = bank("Ben", action="deposit", amount=3650)
check(r["ok"] and r["me"]["deposit"]["principal"] == 3650, "Ben deposits 3,650")
b0 = bal("ben@x")
new_day(); tick()
check(bal("ben@x") - b0 == 0, "4% a year of 3,650 = 0.4 a day: carried, not paid yet")
for _ in range(2):
    new_day(); tick()
check(bal("ben@x") - b0 == 1 - 0, "after 3 days 1 TIDE interest (income tax rounds to 0)")
check(bank("Ben", action="withdraw", amount=4000)["error"] == "insufficient", "cannot withdraw more than the deposit")
check(bank("Ben", action="withdraw", amount=650)["me"]["deposit"]["principal"] == 3000, "withdraw part")
check(bank("Ben", action="borrow", plotId=10, amount=501)["error"] == "too_much", "loan at most 50% of the plot")
check(bank("Ben", action="borrow", plotId=1, amount=100)["error"] == "not_owner", "only your own plot")
check(bank("Ben", action="borrow", plotId=10, amount=500, days=500)["error"] == "days", "term at most 180 days")
r = bank("Ben", action="borrow", plotId=10, amount=500, days=30)
check(r["ok"] and r["me"]["loans"][0]["outstanding"] == 500, f"loan of 500 against plot 10: {r}")
check(bank("Ben", action="borrow", plotId=10, amount=10)["error"] == "pledged", "plot already pledged")
new_day(); tick()
check(J("SELECT aquaterra_loan_json(l) FROM aquaterra_bank_loans l WHERE email = 'ben@x'")["outstanding"] == 500, "8% a year: under 1 TIDE a day carried")
lid = r["loanId"]
check(bank("Ben", action="repay", loanId=lid, amount=200)["ok"], "repay 200")
psql(f"UPDATE aquaterra_bank_loans SET due_at = now() - interval '1 day' WHERE id = {lid}")
new_day(); tick()
au = J("SELECT row_to_json(a) FROM aquaterra_land_auctions a WHERE status = 'open'")
check(au["plot_id"] == 10 and au["reason"] == "loan" and au["owed"] == 300 and au["min_bid"] == 500, f"overdue loan: pledged plot to auction: {au}")
b0, bk = bal("ben@x"), bal("bank:first-light")
psql("UPDATE aquaterra_land_auctions SET ends_at = now() - interval '1 minute' WHERE status = 'open'")
tick()
check(psql("SELECT count(*) FROM aquaterra_plot_owners WHERE plot_id = 10") == "0", "no bids: the Reserve buys it back")
check(bal("bank:first-light") - bk == 300 and bal("ben@x") - b0 == 700, "bank gets what is owed, Ben the rest")
check(psql(f"SELECT status FROM aquaterra_bank_loans WHERE id = {lid}") == "defaulted", "loan closed as defaulted")

# --- the Founder repays by hand; fines; civic bonus; mortgages
f = J("SELECT aquaterra_loan_json(l) FROM aquaterra_bank_loans l WHERE kind = 'founder'")
check(bank("Alexander", action="repay", loanId=f["id"], amount=1000)["ok"], "Founder repays 1,000 by hand")
check(bank("Ben", action="fine", to="Cleo", amount=10, reason="Parking on the plaza")["error"] == "forbidden", "a citizen cannot fine")
check(bank("Alexander", action="fine", to="Cleo", amount=99999, reason="Too big")["error"] == "amount", "fine at most fine_max")
c0 = bal("cleo@x")
r = bank("Alexander", action="fine", to="Cleo", amount=50, reason="Littering in the bay")
check(r["ok"] and r["paid"] == 50 and c0 - bal("cleo@x") == 50, "fine taken at once")
psql("INSERT INTO aquaterra_gov_proposals (id, kind, title, body, author_email, status, stages) VALUES (900, 'charter', 'Test', 'Test', 'ben@x', 'closed', '[]') ON CONFLICT DO NOTHING")
psql("INSERT INTO aquaterra_gov_votes (proposal_id, stage, voter, choice) VALUES (900, 0, 'ben@x', 'yes')")
b0 = bal("ben@x")
new_day(); tick()
check(bal("ben@x") - b0 >= 25 - 3, "voter gets the citizen bonus (taxed)")
b1 = bal("ben@x")
new_day(); tick()
check(bal("ben@x") - b1 < 25 - 3, "bonus once in 30 days")
psql("INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (11, 'ben@x', 500)")
check(psql("SELECT aquaterra_bank_mortgage('ben@x', 11, 10000, 8000, 'Level 1: 10 floors', 'build:test')") != "", "mortgage of 80% of a level")
try:
    psql("SELECT aquaterra_bank_mortgage('ben@x', 11, 10000, 9000, 'Level 2', 'build:test2')")
    check(False, "mortgage over 80% must fail")
except SystemExit as e:
    check("too_much" in str(e), "mortgage over 80% refused")

# --- public pages
ov = bank(None, action="overview")
check(ov["ok"] and ov["laws"]["income_tax_pct"] == 10 and ov["founderLoan"]["borrower"] == "Alexander", "overview: laws and the founder loan")
check(ov["income30"]["incomeTax"] > 0 and ov["income30"]["salaries"] > 0, "overview: treasury income and salaries")
check("ben@x" not in json.dumps(ov) and "info@" not in json.dumps(ov), "no emails in public answers")
check(bank("Ben", action="admin")["error"] == "forbidden", "admin view for founder only")
ad = bank("Alexander", action="admin")
check(ad["ok"] and any(o["office"] == "council" for o in ad["officials"]), "admin sees office holders")
check(J(f"SELECT aquaterra_bank({lit(json.dumps({'action': 'me', 'session': '0' * 64}))}::jsonb)")["error"] == "session", "bad session refused")
check(bank("Ben", action="deposit", amount="abc")["error"] == "amount", "bad number refused")
print(f"ok: {passed} checks passed")
