"""End-to-end test of the arcade on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/arcade/test_arcade.py

Creates a fresh database `aquaterra_arcade_test`, loads the account tables,
the economy (ECONOMY_SQL, default the project copy), the Commonwealth and the
arcade, then plays every game, pays tickets and prizes, rents a plot and
checks that every TIDE is accounted for.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
GOV = os.path.join(HERE, "..", "governance")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_arcade_test"
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

def lit(s):
    return "'" + s.replace("'", "''") + "'"

def arc(req):
    return json.loads(psql(f"SELECT aquaterra_arcade({lit(json.dumps(req))}::jsonb)"))

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
load(os.path.join(HERE, "..", "travel", "travel.sql"))  # aquaterra_player_where: where a citizen stands
for _ in range(2):  # the migration must be safe to run again
    for f in ["schema.sql", "bank.sql", "functions.sql", "api.sql"]:
        load(os.path.join(HERE, f))

S = {}
def player(email, name, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name)}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[name] = tok
    EMAIL[name] = email

EMAIL = {}
def stand(who, plot):
    """Walk the citizen onto a plot, the way the travel system records it."""
    e = EMAIL[who]
    psql(f"SELECT aquaterra_player_where({lit(e)})")
    psql(f"UPDATE aquaterra_locations SET spot = 'plot', plot_id = {plot} WHERE email = {lit(e)}")

def as_(who, stand_there=True, **req):
    # to play, a citizen walks to the attraction's plot first (tests of "not here" pass stand_there=False)
    if req.get("action") == "start" and stand_there:
        plot = psql(f"SELECT plot_id FROM aquaterra_arcade WHERE id = {int(req['id'])}")
        if plot:
            stand(who, int(plot))
    req["session"] = S[who]
    return arc(req)

def bal(acct):
    v = psql(f"SELECT balance FROM aquaterra_wallets WHERE account = {lit(acct)}")
    return int(v) if v else 0

def grant(email, n):
    psql(f"SELECT aquaterra_move('treasury', {lit(email)}, {n}, 'grant', NULL, 'test', NULL)")

def total():
    return int(psql("SELECT sum(balance) FROM aquaterra_wallets"))

# --- a small world: 4 districts on 3 lands, 40 plots
D = [(0, "First Light City", "metropolis", "Continent"), (1, "Ember Fields", "volcanic", "Continent"),
     (2, "Coral Bay", "oceania", "Oceania"), (3, "Reedwater", "wetland", "Greenhaven Isle"), (4, "Frostmere", "tundra", "Northern Archipelago")]
for i, n, b, l in D:
    psql(f"INSERT INTO aquaterra_districts (id, name, biome, land) VALUES ({i}, {lit(n)}, {lit(b)}, {lit(l)})")
for pid in range(40):
    d = D[pid % 5][1]
    psql(f"INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES ({pid}, '{pid + 1} Test Street', {lit(d)}, 4, 400)")
psql("INSERT INTO aquaterra_plots (id, address, district, tiles, price) VALUES (40, 'Water Plot 1-1', 'Open sea', 64, 100)")

for e, n in [("owner@x", "Olga"), ("ava@x", "Ava"), ("ben@x", "Ben"), ("cleo@x", "Cleo")]:
    player(e, n)
for e in ["owner@x", "ava@x", "ben@x", "cleo@x"]:
    psql(f"INSERT INTO aquaterra_wallets (account) VALUES ({lit(e)}) ON CONFLICT DO NOTHING")
grant("owner@x", 5000); grant("ava@x", 1000); grant("ben@x", 1000); grant("cleo@x", 300)
psql("INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (0, 'owner@x', 400), (1, 'owner@x', 400), (2, 'owner@x', 400)")
T0 = total()

# --- the map wakes NICS AI: pop-ups on free plots in different districts
m = arc({"action": "map"})
check(m["ok"], "public map works")
ai = [x for x in m["attractions"] if x["ai"]]
check(len(ai) == 5, f"one NICS AI pop-up per district (5 districts), got {len(ai)}")
check(ai[0]["template"] == "quiz" or any(x["template"] == "quiz" for x in ai), "NICS AI always opens a quiz")
plots = [x["plotId"] for x in ai]
check(all(p not in (0, 1, 2, 40) for p in plots), "pop-ups only on free land plots")
check(len(m["mind"]) == 1 and "Opened 5 attractions" in m["mind"][0]["text"], "book of experience written")
check(int(psql("SELECT count(*) FROM aquaterra_arcade_questions WHERE source = 'ai'")) >= 10, "world questions written from districts")
check(arc({"action": "map"})["attractions"] == m["attractions"], "once a day only")
escrow = bal("arcade:escrow")
check(escrow == int(psql("SELECT sum(pool) FROM aquaterra_arcade WHERE status = 'open'")) and escrow > 0, "AI prize pools funded from the Reserve")
check(total() == T0, "no coins created")

# --- an owner opens a quiz with their own questions
qs = [{"q": "Capital of AquaTerra?", "answer": "First Light City", "wrong": ["Coral Bay", "Ember Fields", "Reedwater"]},
      {"q": "Coin of the city?", "answer": "Tide", "wrong": ["Wave", "Pearl", "Spark"]},
      {"q": "Who lives in the tower?", "answer": "NICS AI", "wrong": ["Mayor", "Nobody", "Ben"]}]
r = as_("Ava", action="place", plotId=0, template="quiz", title="Ava's quiz", topic="custom", questions=qs)
check(not r["ok"] and r["error"] == "forbidden", "only the owner or tenant can place")
r = as_("Olga", action="place", plotId=0, template="quiz", title="Olga's Quiz", topic="custom", questions=qs[:2])
check(not r["ok"] and r["error"] == "questions", "at least three questions")
r = as_("Olga", action="place", plotId=0, template="quiz", title="Olga's Quiz", topic="custom", questions=qs, entryFee=20, prize=100, deposit=150, difficulty="easy")
check(r["ok"], f"owner places a quiz: {r}")
quiz = r["attraction"]
check("First Light City" not in json.dumps(r), "answers never leave the server")
check(bal("owner@x") == 5000 - 150, "deposit taken")
r = as_("Olga", action="place", plotId=0, template="maze", title="Second")
check(not r["ok"] and r["error"] == "exists", "one attraction per plot")

# --- playing needs being on the plot
psql("UPDATE aquaterra_locations SET plot_id = NULL, spot = 'centre'")
r = as_("Ava", stand_there=False, action="start", id=quiz["id"])
check(not r["ok"] and r["error"] == "not_here", "away from the plot you cannot play")
check(arc({"action": "plot", "plotId": 0, "session": S["Ava"]})["me"]["here"] is False, "plot card says you are not here")
stand("Ava", 0)
check(arc({"action": "plot", "plotId": 0, "session": S["Ava"]})["me"]["here"] is True, "after walking there you are")

# --- Ava plays it: ticket 20, 5% tax to the state, the rest to the owner
st = int(psql("SELECT COALESCE((SELECT balance FROM aquaterra_wallets WHERE account = 'state:treasury'), 0)"))
r = as_("Ava", action="start", id=quiz["id"])
check(r["ok"] and r["fee"] == 20 and len(r["game"]["questions"]) == 3, f"start quiz: {r}")
check(all(len(q["options"]) == 4 for q in r["game"]["questions"]), "four options")
check(bal("ava@x") == 980 and bal("owner@x") == 4850 + 19, "ticket paid, owner gets 19")
check(bal("state:treasury") == st + 1, "ticket tax 1 to the State Treasury")
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {r['run']}"))
res = as_("Ava", action="finish", run=r["run"], answers=ans)
check(res["ok"] and res["won"] and res["score"] == 3, f"all right answers win: {res}")
check(res["prize"] == 100 and res["tax"] == 5, "prize 100, tax 5")
check(bal("ava@x") == 980 + 95, "winner receives 95")
r2 = as_("Ava", action="start", id=quiz["id"])
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {r2['run']}"))
res = as_("Ava", action="finish", run=r2["run"], answers=ans)
check(res["won"] and res["prize"] == 0, "one prize per attraction per player a day")
r3 = as_("Ava", action="start", id=quiz["id"])
as_("Ava", action="finish", run=r3["run"], answers=[9, 9, 9])
r4 = as_("Ava", action="start", id=quiz["id"])
check(not r4["ok"] and r4["error"] == "attempts", "three tries a day")
r = as_("Ava", action="finish", run=r3["run"], answers=[0, 0, 0])
check(not r["ok"] and r["error"] == "done", "a run finishes once")

# --- the owner can try for free, no prize, no stats
pl = as_("Olga", action="start", id=quiz["id"])
check(pl["ok"] and pl["practice"] and pl["fee"] == 0, "owner practice is free")
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {pl['run']}"))
res = as_("Olga", action="finish", run=pl["run"], answers=ans)
check(res["won"] and res["prize"] == 0, "no prize on practice")

# --- pool runs dry: prize limited by what is left (pool 50 now)
r = as_("Ben", action="start", id=quiz["id"])
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {r['run']}"))
res = as_("Ben", action="finish", run=r["run"], answers=ans)
check(res["prize"] == 50, f"prize capped by pool: {res['prize']}")
check(int(psql(f"SELECT pool FROM aquaterra_arcade WHERE id = {quiz['id']}")) == 0, "pool empty")

# --- late answers lose
r = as_("Cleo", action="start", id=quiz["id"])
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {r['run']}"))
psql(f"UPDATE aquaterra_arcade_runs SET deadline = now() - interval '1 second' WHERE id = {r['run']}")
res = as_("Cleo", action="finish", run=r["run"], answers=ans)
check(not res["won"] and res["score"] == 0, "too late scores nothing")

# --- crystals, move by move
r = as_("Olga", action="place", plotId=1, template="crystals", title="Crystal Cave", entryFee=0, prize=40, deposit=200)
check(r["ok"], "crystal hunt placed")
cry = r["attraction"]
s = as_("Ben", action="start", id=cry["id"])
check(s["ok"] and "cells" not in json.dumps(s), "crystal spots stay secret")
cells = json.loads(psql(f"SELECT secret->'cells' FROM aquaterra_arcade_runs WHERE id = {s['run']}"))
size = s["game"]["size"]
miss = next(c for c in range(size * size) if c not in cells)
mv = as_("Ben", action="move", run=s["run"], cell=miss)
check(mv["ok"] and not mv["hit"] and mv["near"] >= 1, f"a miss tells the distance: {mv}")
check(not as_("Ben", action="move", run=s["run"], cell=miss)["ok"], "same cell twice refused")
for c in cells[:4]:
    mv = as_("Ben", action="move", run=s["run"], cell=c)
check(mv["hit"] and mv["found"] == 4, "hits counted")
res = as_("Ben", action="finish", run=s["run"])
check(res["won"] and res["score"] == 4 and res["prize"] == 40 and res["tax"] == 2, f"crystal win pays 40 minus tax: {res}")

# --- maze: a real path wins, a path through a wall loses
r = as_("Olga", action="place", plotId=2, template="maze", title="Tide Maze", difficulty="easy", prize=10, deposit=30)
mz = r["attraction"]
s = as_("Cleo", action="start", id=mz["id"])
n = s["game"]["size"]; cells = s["game"]["cells"]
def solve():
    from collections import deque
    prev = {0: None}; q = deque([0])
    while q:
        c = q.popleft()
        for bit, d, ch in ((1, -n, "U"), (2, 1, "R"), (4, n, "D"), (8, -1, "L")):
            if cells[c] & bit and c + d not in prev:
                prev[c + d] = (c, ch); q.append(c + d)
    path = []; c = n * n - 1
    while prev[c]:
        c, ch = prev[c]; path.append(ch)
    return "".join(reversed(path))
check(sum(bin(x).count("1") for x in cells) == 2 * (n * n - 1), "a perfect maze (a tree)")
res = as_("Cleo", action="finish", run=s["run"], path=solve())
check(not res["won"], "a maze solved faster than anyone can walk is refused")
s = as_("Cleo", action="start", id=mz["id"])
n = s["game"]["size"]; cells = s["game"]["cells"]
psql(f"UPDATE aquaterra_arcade_runs SET started_at = now() - interval '12 seconds' WHERE id = {s['run']}")
res = as_("Cleo", action="finish", run=s["run"], path=solve())
check(res["won"] and res["score"] > 0, f"maze solved: {res}")
s = as_("Ava", action="start", id=mz["id"])
wall = "U" if not (s["game"]["cells"][0] & 1) else "L"
res = as_("Ava", action="finish", run=s["run"], path=wall)
check(not res["won"], "walking through a wall loses")

# --- range: hits must fall in the window and not before their time
r = as_("Olga", action="place", plotId=0 + 5, template="range", title="x")
check(not r["ok"] and r["error"] == "forbidden", "cannot place on someone else's free plot")
psql("INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES (3, 'owner@x', 400), (4, 'owner@x', 400)")
rg = as_("Olga", action="place", plotId=3, template="range", title="Light Range", difficulty="easy")["attraction"]
s = as_("Ben", action="start", id=rg["id"])
sched = s["game"]["schedule"]
hits = [[t["id"], t["t"] + 100] for t in sched]
res = as_("Ben", action="finish", run=s["run"], hits=hits)
check(not res["won"] and res["detail"].get("reason") == "time", "hits from the future are refused")
s = as_("Ben", action="start", id=rg["id"])
psql(f"UPDATE aquaterra_arcade_runs SET started_at = now() - interval '30 seconds' WHERE id = {s['run']}")
sched = s["game"]["schedule"]
hits = [[t["id"], t["t"] + 100] for t in sched[:13]] + [[sched[14]["id"], sched[14]["t"] + 99999]]
res = as_("Ben", action="finish", run=s["run"], hits=hits)
check(res["won"] and res["score"] == 13, f"13 good hits of 20 win on easy: {res}")

# --- race: follow a safe lane
rc = as_("Olga", action="place", plotId=4, template="race", title="Wave Race", difficulty="easy")["attraction"]
s = as_("Cleo", action="start", id=rc["id"])
g = s["game"]; rows = g["rows"]
rocks = {r_[0]: set(r_[1]) for r_ in g["rocks"]}
# find any path by DP (one lane step per row)
best = {1: []}
for row in range(rows):
    nxt = {}
    for lane, sw in best.items():
        for nl in (lane - 1, lane, lane + 1):
            if 0 <= nl <= 2 and nl not in rocks.get(row, set()) and nl not in nxt:
                nxt[nl] = sw + ([[row, nl]] if nl != lane else [])
    best = nxt
check(best, "every course can be finished")
psql(f"UPDATE aquaterra_arcade_runs SET started_at = now() - interval '20 seconds' WHERE id = {s['run']}")
res = as_("Cleo", action="finish", run=s["run"], switches=next(iter(best.values())))
check(res["won"] and res["score"] == rows, f"race finished: {res}")
s = as_("Ava", action="start", id=rc["id"])
psql(f"UPDATE aquaterra_arcade_runs SET started_at = now() - interval '20 seconds' WHERE id = {s['run']}")
crash_row = min(r_[0] for r_ in s["game"]["rocks"] if 1 in r_[1])
res = as_("Ava", action="finish", run=s["run"], switches=[])
check(not res["won"] and res["score"] == crash_row, f"staying in lane hits a rock: {res} {crash_row}")

# --- NICS AI attraction: free entry, prize from the Reserve's pool
aiq = next(x for x in ai if x["template"] == "quiz")
s = as_("Cleo", action="start", id=aiq["id"])
check(s["ok"] and s["fee"] == 0, "AI pop-ups are free")
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {s['run']}"))
res = as_("Cleo", action="finish", run=s["run"], answers=ans)
check(res["won"] and res["prize"] > 0, "AI prize paid")

# --- daily prize cap
psql("UPDATE aquaterra_gov_params SET value = 10 WHERE key = 'arcade_daily_prize_cap'")
pl = as_("Olga", action="place", plotId=2, template="maze", title="x")
check(not pl["ok"], "plot 2 still has its maze")
cap_plot = int(psql("SELECT p.id FROM aquaterra_plots p WHERE NOT EXISTS (SELECT 1 FROM aquaterra_plot_owners o WHERE o.plot_id = p.id) AND NOT EXISTS (SELECT 1 FROM aquaterra_arcade a WHERE a.plot_id = p.id AND a.status = 'open') AND address NOT LIKE 'Water%' LIMIT 1"))
psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({cap_plot}, 'owner@x', 400)")
cq = as_("Olga", action="place", plotId=cap_plot, template="quiz", title="Cap Quiz", topic="elements", prize=500, deposit=500)["attraction"]
s = as_("Ava", action="start", id=cq["id"])
ans = json.loads(psql(f"SELECT secret->'answers' FROM aquaterra_arcade_runs WHERE id = {s['run']}"))
res = as_("Ava", action="finish", run=s["run"], answers=ans)
check(res["won"] and res["prize"] == 0, "Ava already won 100 today, over the cap of 10")
psql("UPDATE aquaterra_gov_params SET value = 500 WHERE key = 'arcade_daily_prize_cap'")

# --- quests
me = as_("Cleo", action="me")
check(me["ok"] and len(me["quests"]) == 3, "three quests a day")
check(me["ranking"]["top"] and me["ranking"]["me"]["points"] > 0, "ranking counts Cleo")
q = me["quests"][0]
r = as_("Cleo", action="claim_quest", quest="nope")
check(not r["ok"] and r["error"] == "quest", "unknown quest")
done = [x for x in me["quests"] if x["progress"] >= x["need"]]
if done:
    before = bal("cleo@x")
    r = as_("Cleo", action="claim_quest", quest=done[0]["id"])
    check(r["ok"] and bal("cleo@x") == before + done[0]["reward"], "quest reward paid")
    check(not as_("Cleo", action="claim_quest", quest=done[0]["id"])["ok"], "once a day")
notyet = [x for x in me["quests"] if x["progress"] < x["need"]]
if notyet:
    check(as_("Cleo", action="claim_quest", quest=notyet[0]["id"])["error"] == "not_ready", "unfinished quest refused")

# --- rent: Olga lists plot 1 (her crystal cave is there, so it is busy)
check(as_("Ben", action="rent_offer", plotId=1, pricePerDay=10, maxDays=5)["error"] == "forbidden", "only the owner lists for rent")
check(as_("Olga", action="rent_offer", plotId=1, pricePerDay=50, maxDays=5)["ok"], "listed")
check(as_("Ben", action="rent", plotId=1, days=2)["error"] == "busy", "her own attraction is there")
as_("Olga", action="close", id=cry["id"])
check(as_("Ben", action="rent", plotId=1, days=9)["error"] == "days", "too many days")
before_o, before_s = bal("owner@x"), bal("state:treasury")
r = as_("Ben", action="rent", plotId=1, days=2)
check(r["ok"] and r["paid"] == 100 and r["tax"] == 3, f"rent paid with 3% tax: {r}")
check(bal("owner@x") == before_o + 97 and bal("state:treasury") == before_s + 3, "owner gets rent minus tax")
check(as_("Olga", action="place", plotId=1, template="maze", title="Mine again")["error"] == "forbidden", "owner cannot place while rented")
r = as_("Ben", action="place", plotId=1, template="maze", title="Ben's Maze", prize=20, deposit=60)
check(r["ok"], "tenant places")
info = arc({"action": "plot", "plotId": 1})
check(info["rental"]["tenant"] == "Ben" and info["attraction"]["operator"] == "Ben", "plot shows tenant")
check(as_("Cleo", action="rent", plotId=1, days=1)["error"] == "no_offer", "offer gone once rented")
bb = bal("ben@x")
psql("UPDATE aquaterra_arcade_rentals SET ends_at = now() - interval '1 second' WHERE plot_id = 1")
arc({"action": "map"})
check(bal("ben@x") == bb + 60, "rent over: tenant's attraction closes and the pool comes back")
check(as_("Olga", action="place", plotId=1, template="race", title="Back home")["ok"], "owner has the plot again")

# --- owner moves onto a plot where NICS AI had a pop-up
aip = ai[-1]["plotId"]
psql(f"INSERT INTO aquaterra_plot_owners (plot_id, owner, price_paid) VALUES ({aip}, 'ava@x', 400)")
tr = bal("treasury")
r = as_("Ava", action="place", plotId=aip, template="crystals", title="Ava's Cave")
check(r["ok"], "owner replaces the AI pop-up")
check(bal("treasury") > tr, "AI pool returned to the Reserve")

# --- topup, update, close refunds
r = as_("Olga", action="topup", id=quiz["id"], amount=100)
check(r["ok"] and r["attraction"]["pool"] == 100, "topup")
r = as_("Olga", action="update", id=quiz["id"], entryFee=0, difficulty="hard", title="Hard Quiz")
check(r["ok"] and r["attraction"]["difficulty"] == "hard" and r["attraction"]["entryFee"] == 0, "update")
ob = bal("owner@x")
r = as_("Olga", action="close", id=quiz["id"])
check(r["ok"] and bal("owner@x") == ob + 100, "close refunds")
check(as_("Ava", action="close", id=rc["id"])["error"] == "forbidden", "only the operator closes")

# --- welcome coins cannot pay tickets or deposits
psql("INSERT INTO aquaterra_players (email, display_name) VALUES ('new@x', 'Neo')")
tok = hashlib.sha256(b"new@x").hexdigest()
psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), 'new@x', now() + interval '1 day')")
S["Neo"] = tok
EMAIL["Neo"] = "new@x"
psql("SELECT aquaterra_economy(jsonb_build_object('action', 'wallet', 'session', " + lit(tok) + "))")
check(bal("new@x") == 1000, "welcome coins")
psql(f"UPDATE aquaterra_arcade SET entry_fee = 10 WHERE id = {rc['id']}")
check(as_("Neo", action="start", id=rc["id"])["error"] == "insufficient", "welcome coins cannot buy tickets")

# --- every TIDE accounted for
escrow = bal("arcade:escrow")
check(escrow == int(psql("SELECT COALESCE(sum(pool), 0) FROM aquaterra_arcade WHERE status = 'open'")), f"escrow {escrow} equals open pools")
supply = int(psql("SELECT sum(balance) FROM aquaterra_wallets"))
genesis = int(psql("SELECT value FROM aquaterra_economy_params WHERE key = 'genesis_supply'"))
check(supply == genesis, f"supply {supply} equals genesis {genesis}: nothing minted, nothing lost")

# --- the next day NICS AI learns and moves its pop-ups
psql("UPDATE aquaterra_arcade SET ai_day = ai_day - 1 WHERE operator = 'nics-ai'")
psql("UPDATE aquaterra_arcade_ai_log SET day = day - 1")
psql("UPDATE aquaterra_arcade_runs SET started_at = started_at - interval '1 day'")
m2 = arc({"action": "map"})
check(len(m2["mind"]) == 2 and "Most played this week" in m2["mind"][0]["text"], f"AI notes what people played: {m2['mind'][0]['text']}")
check(int(psql("SELECT count(*) FROM aquaterra_arcade WHERE operator = 'nics-ai' AND status = 'open' AND ai_day < current_date")) == 0, "yesterday's pop-ups closed")
supply = int(psql("SELECT sum(balance) FROM aquaterra_wallets"))
check(supply == genesis, "still balanced after the AI day")
check(bal("arcade:escrow") == int(psql("SELECT COALESCE(sum(pool), 0) FROM aquaterra_arcade WHERE status = 'open'")), "escrow equals pools after the AI day")

# --- ledger names
names = psql("SELECT string_agg(DISTINCT aquaterra_name(to_account), ',') FROM aquaterra_ledger WHERE kind IN ('arcade_pool', 'arcade_refund')")
check("Prize pools" in names, "escrow has a name in histories")

print(f"ok: {passed} checks passed")
