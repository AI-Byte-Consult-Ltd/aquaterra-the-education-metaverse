"""End-to-end test of NICS AI daily quests on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/quests/test_quests.py

Loads the account fixture, the Tide economy (ECONOMY_SQL, default the project
copy), the Commonwealth, travel, the Arcade, treasury and quests.sql (twice:
the migration must be safe to run again), then plays a day of quests.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ARC = os.path.join(ROOT, "server", "arcade")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_quests_test"
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
load(os.path.join(ROOT, "server", "treasury", "treasury.sql"))
for _ in range(2):
    load(os.path.join(HERE, "quests.sql"))

S, EMAIL = {}, {}


def player(email, name, tide=0):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name)}, 'citizen')")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    psql(f"INSERT INTO aquaterra_wallets (account, balance) VALUES ({lit(email)}, {tide}) ON CONFLICT (account) DO UPDATE SET balance = {tide}")
    S[name], EMAIL[name] = tok, email


def bal(acct):
    return int(psql(f"SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}), 0)"))


def Q(name, **kw):
    req = dict(kw, session=S[name]) if name else dict(kw)
    return J(f"SELECT aquaterra_quests({lit(json.dumps(req))}::jsonb)")


# a small world: capital, two districts with stations, one without
for i, n, cap in [(1, "First Light City", "true"), (2, "Mistmarsh", "false"), (3, "Reedwater", "false"), (4, "Nowhere", "false")]:
    psql(f"INSERT INTO aquaterra_districts (id, name, biome, land, capital) VALUES ({i}, {lit(n)}, 'temperate', 'main', {cap}) ON CONFLICT (id) DO UPDATE SET capital = {cap}")
for i in [1, 2, 3]:
    psql(f"INSERT INTO aquaterra_travel_hubs (id, kind, district_id, name, x, y, price) VALUES ('station:{i}', 'station', {i}, 'Station {i}', 0, 0, 1000) ON CONFLICT DO NOTHING")
for pid, d in [(10, "Mistmarsh"), (11, "Reedwater"), (12, "First Light City")]:
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, 'Lot {pid}', {lit(d)}, 4, 500) ON CONFLICT DO NOTHING")
psql("UPDATE aquaterra_wallets SET balance = 10000000 WHERE account = 'treasury'")
player("ava@x", "Ava")
player("ben@x", "Ben")
player("cleo@x", "Cleo")
# Mistmarsh was visited this week, Reedwater not
psql("INSERT INTO aquaterra_trips (email, from_district, to_district, legs, fare, tax) VALUES ('ben@x', 1, 2, '[{\"mode\":\"train\"}]', 10, 1)")

# --- empty fund: quests exist, rewards are zero, said honestly
psql("UPDATE aquaterra_wallets SET balance = 0 WHERE account = 'nics-ai'")
v = Q(None, action="today")
check(v["ok"] and v["pot"] == 0 and all(q["reward"] == 0 for q in v["quests"]), f"empty fund: no rewards {v}")
ids = [q["id"] for q in v["quests"]]
check(ids == ["visit", "play", "ride", "ask"], f"four quests in order: {ids}")
check(all("answer" not in q for q in v["quests"]), "answer of the question is hidden")
visit = v["quests"][0]
check(visit["district"] == 3 and visit["districtName"] == "Reedwater", "visit: least visited reachable district, never the capital")
check(v["quests"][2]["mode"] in ("ferry", "plane"), "ride: a mode nobody used this week (train was used)")
play = v["quests"][1]
check(play["arcade"] > 0 and play["plotId"] in (10, 11, 12), "play: one of today's NICS AI pop-ups")
check("fewest visitors" in v["note"], "NICS AI explains its choice")
check(Q(None, action="today")["quests"] == v["quests"], "same quests all day")

# --- a new day with a funded NICS AI: rewards from the fund
psql("DELETE FROM aquaterra_quest_days")
psql("UPDATE aquaterra_wallets SET balance = 1000 WHERE account = 'nics-ai'")
psql("INSERT INTO aquaterra_gov_proposals (kind, title, status, stages) VALUES ('motion', 'Plant trees', 'signatures', '[]')")
v = Q("Ava", action="today")
ids = [q["id"] for q in v["quests"]]
check(ids == ["visit", "play", "civic", "ask"], f"civic quest while a proposal is open: {ids}")
check(v["pot"] == 300, "pot = law quest_daily_pot when the fund is larger")
rw = {q["id"]: q["reward"] for q in v["quests"]}
check(all(0 < r <= 40 for r in rw.values()), f"rewards between 1 and the cap: {rw}")
check(rw["visit"] > rw["ask"], "travel pays more than a question")
check(v["taxPct"] == 10, "income tax 10% shown")
check(not any(q["done"] for q in v["quests"]), "nothing done yet")

# claim before done
r = Q("Ava", action="claim", quest="visit")
check(r["error"] == "not_ready", "cannot claim before the deed")
check(Q("Ava", action="claim", quest="nope")["error"] == "quest", "unknown quest")
check(Q(None, action="claim", quest="visit")["error"] == "session", "claim needs a session")

# travel to Reedwater and claim: fund pays, 10% tax goes to the State Treasury
psql("INSERT INTO aquaterra_trips (email, from_district, to_district, legs, fare, tax) VALUES ('ava@x', 1, 3, '[{\"mode\":\"train\"}]', 10, 1)")
st0, f0 = bal("state:treasury"), bal("nics-ai")
r = Q("Ava", action="claim", quest="visit")
check(r["ok"] and r["reward"] == rw["visit"], f"visit paid {r}")
check(r["tax"] == int(psql(f"SELECT round({rw['visit']} * 0.10)")), f"tax reported {r['tax']}")
check(bal("ava@x") == rw["visit"] - r["tax"], "Ava got the reward minus tax")
check(bal("nics-ai") == f0 - rw["visit"], "reward came from the NICS AI fund")
check(bal("state:treasury") == st0 + r["tax"], "tax went to the State Treasury")
check(psql("SELECT count(*) FROM aquaterra_ledger WHERE kind = 'quest' AND from_account = 'nics-ai'") == "1", "ledger row kind quest")
check(Q("Ava", action="claim", quest="visit")["error"] == "claimed", "one claim per quest a day")

# standing in the district also counts
psql("INSERT INTO aquaterra_locations (email, district_id) VALUES ('ben@x', 3)")
check(Q("Ben", action="today")["quests"][0]["done"], "standing in the district counts as a visit")

# play the pop-up
psql(f"INSERT INTO aquaterra_arcade_runs (arcade_id, player, deadline, status, score, won) VALUES ({play['arcade']}, 'ava@x', now(), 'done', 1, false)")
check(Q("Ava", action="claim", quest="play")["ok"], "play claimed after a finished game")
psql(f"INSERT INTO aquaterra_arcade_runs (arcade_id, player, deadline, status, practice) VALUES ({play['arcade']}, 'cleo@x', now(), 'done', true)")
check(Q("Cleo", action="claim", quest="play")["error"] == "not_ready", "practice runs do not count")

# civic: sign the petition
pid = psql("SELECT id FROM aquaterra_gov_proposals LIMIT 1")
psql(f"INSERT INTO aquaterra_gov_signatures (proposal_id, email) VALUES ({pid}, 'ava@x')")
check(Q("Ava", action="claim", quest="civic")["ok"], "civic claimed after signing")

# the question: one try
ask = [q for q in Q("Ava", action="today")["quests"] if q["id"] == "ask"][0]
check(len(ask["options"]) == 4, "four options")
secret = J("SELECT quests FROM aquaterra_quest_days")
right = [q for q in secret if q["id"] == "ask"][0]["answer"]
r = Q("Cleo", action="answer", choice=(right + 1) % 4)
check(r["ok"] and not r["correct"], "wrong answer is wrong")
check(Q("Cleo", action="answer", choice=right)["error"] == "answered", "one try only")
check(Q("Cleo", action="claim", quest="ask")["error"] == "not_ready", "wrong answer: no reward")
r = Q("Ava", action="answer", choice=right)
check(r["correct"] and [q for q in r["quests"] if q["id"] == "ask"][0]["answer"] == right, "answer shown after trying")
check(Q("Ava", action="claim", quest="ask")["ok"], "right answer pays")
check(Q("Ava", action="answer", choice=9)["error"] in ("choice", "answered"), "bad choice refused")

# the day's pot runs out: quest done, nothing paid, said so
psql("UPDATE aquaterra_quest_days SET paid = pot")
psql("INSERT INTO aquaterra_trips (email, from_district, to_district, legs, fare, tax) VALUES ('cleo@x', 1, 3, '[]', 0, 0)")
b0 = bal("cleo@x")
r = Q("Cleo", action="claim", quest="visit")
check(r["ok"] and r["reward"] == 0 and r["fundEmpty"] and r["potLeft"] == 0, f"pot spent: honest zero {r}")
check(bal("cleo@x") == b0, "nothing paid")

# journal and laws
j = Q(None, action="journal")
check(j["ok"] and j["days"][0]["people"] >= 1 and j["days"][0]["note"], "journal of NICS AI decisions")
check(psql("SELECT count(*) FROM aquaterra_gov_params WHERE key IN ('quest_daily_pot', 'quest_reward_max')") == "2", "two new laws")
check(Q("Ava", action="bogus")["error"] == "action", "unknown action")

print(f"ok: {passed} checks passed")
