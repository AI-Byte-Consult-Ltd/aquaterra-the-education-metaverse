"""End-to-end test of the City Mind bridge on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/mind/test_mind.py

Loads the game schema, nics.sql, quests.sql and mind.sql (twice: safe to run again), then plays
the lab's side by hand: register releases, promote with an exam, fetch the cleaned corpus.
"""
import hashlib, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GOV = os.path.join(ROOT, "server", "governance")
ARC = os.path.join(ROOT, "server", "arcade")
ECONOMY = os.environ.get("ECONOMY_SQL", "/mnt/project-files/aquaterra-economy/economy.sql")
DB = "aquaterra_mind_test"
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
load(os.path.join(ROOT, "server", "quests", "quests.sql"))
load(os.path.join(ROOT, "server", "nics", "nics.sql"))
for _ in range(2):
    load(os.path.join(HERE, "mind.sql"))

S = {}


def player(email):
    psql(f"INSERT INTO aquaterra_players (email, display_name) VALUES ({lit(email)}, {lit(email.split('@')[0])})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[email.split("@")[0]] = tok


nics = lambda who, **kw: J(f"SELECT aquaterra_nics({lit(json.dumps(dict(kw, session=S[who])))}::jsonb)")
mind = lambda **kw: J(f"SELECT aquaterra_mind({lit(json.dumps(kw))}::jsonb)")
RKEY = psql("SELECT value FROM aquaterra_mind_settings WHERE key = 'release_key'")
EKEY = psql("SELECT value FROM aquaterra_nics_settings WHERE key = 'export_key'")
check(len(RKEY) == 64 and RKEY != EKEY, "release key made once, separate from the export key")

st = mind(action="status")
check(st["ok"] and st["live"] is None and st["releases"] == [], "empty status")

man = json.load(open(os.path.join(ROOT, "src", "game", "mind", "__fixtures__", "release", "manifest.json")))
URL = "language/nics-text-micro-v1"
check(mind(action="release", manifest=man, prefix=URL)["error"] == "forbidden", "release needs the key")
check(mind(action="release", key=EKEY, manifest=man, prefix=URL)["error"] == "forbidden", "export key cannot release")
check(mind(action="release", key=RKEY, manifest=man, prefix="https://x.org/a")["error"] == "prefix", "a key inside the private bucket, not a URL")
check(mind(action="release", key=RKEY, manifest=dict(man, format="pt"), prefix=URL)["error"] == "format", "format checked")
check(mind(action="release", key=RKEY, manifest=dict(man, weights_sha256="zz"), prefix=URL)["error"] == "checksum", "checksum checked")
r = mind(action="release", key=RKEY, manifest=man, prefix=URL)
params = sum(eval("*".join(map(str, t["shape"]))) for t in man["tensors"])
check(r["ok"] and r["release"]["status"] == "shadow" and r["release"]["params"] == params and "baseUrl" not in r["release"] and "prefix" not in json.dumps(r["release"]), f"registered, location not public {r}")
check(mind(action="release", key=RKEY, manifest=man, prefix=URL)["error"] == "exists", "same version once")

check(mind(action="promote", key=RKEY, version=1, exam={"total": 5, "passed": 5})["error"] == "exam", "exam needs 20+ answers")
r = mind(action="promote", key=RKEY, version=1, exam={"total": 40, "passed": 30})
check(r["ok"] and r["live"] is False, "failed exam stays in shadow")
check(mind(action="status")["live"] is None, "nothing live")
r = mind(action="promote", key=RKEY, version=1, exam={"total": 40, "passed": 38})
check(r["live"] and mind(action="status")["live"]["version"] == 1, "passed exam goes live")
r = mind(action="release", key=RKEY, manifest=dict(man, version=2, step=900), prefix=URL)
mind(action="promote", key=RKEY, version=2, exam={"total": 40, "passed": 40})
st = mind(action="status")
check(st["live"]["version"] == 2 and [x["status"] for x in st["releases"]] == ["live", "retired"], "one live release at a time")
check(mind(action="release", key=RKEY, manifest=dict(man, version=1), prefix=URL)["error"] in ("exists", "older"), "no going back in numbers")

# questions answered on the server: session, live release, rate limit; file location only for n8n
check(mind(action="ask", topic="wallet", question="hi")["error"] == "session", "ask needs a session")
check(URL not in json.dumps(mind(action="status")), "status never shows where the weights are")
# corpus: consent, 👎, mute, duplicates and the per-day cap
for p in ["ann@x.org", "bob@x.org", "eve@x.org", "zed@x.org"]:
    player(p)
for p in ["ann", "bob", "eve"]:
    nics(p, action="set_consent", consent=True)
psql("UPDATE aquaterra_mind_settings SET value = '5' WHERE key = 'lines_per_resident_day'")
log = lambda who, q: nics(who, action="log", qtype="wallet", source="phrase", question=q, answer="Your balance is 1 TIDE.", lang="en")
for i in range(3):
    log("ann", f"how much tide {i}")
bad = log("ann", "rate me down")["id"]
nics("ann", action="rate", id=str(bad), rating="-1")
log("ann", "how much tide 0")  # duplicate question
for i in range(9):
    log("bob", f"flood {i}")
log("eve", "poison")
log("zed", "no consent")  # not stored at all
eve = psql("SELECT aquaterra_nics_resident('eve@x.org')")
psql(f"INSERT INTO aquaterra_mind_muted (resident, reason) VALUES ({lit(eve)}, 'test')")
check(mind(action="corpus", key=RKEY)["error"] == "forbidden", "corpus takes the export key")
c = mind(action="corpus", key=EKEY, limit=100)
qs = [l["question"] for l in c["lines"]]
check(sum(q.startswith("how much tide") for q in qs) == 3, f"ann: 3 unique lines {qs}")
check("rate me down" not in qs and "poison" not in qs and "no consent" not in qs, "👎, muted, no consent left out")
check(sum(q.startswith("flood") for q in qs) == 5, "bob capped at 5 a day")
check(c["dropped"] == 1 + 1 + 4 + 1, f"dropped counted {c['dropped']}")
check(isinstance(c["civic"]["laws"], list) and isinstance(c["civic"]["quest_notes"], list), "civic texts on the first fetch")
c2 = mind(action="corpus", key=EKEY, after=c["next"])
check(c2["lines"] == [] and c2["next"] == c["next"] and c2["civic"] is None, "cursor moves on")
nics("ann", action="forget")
check(not any(l["question"].startswith("how much") for l in mind(action="corpus", key=EKEY)["lines"]), "forget removes lines")
a = J(f"SELECT aquaterra_mind({lit(json.dumps(dict(action='ask', session=S['bob'], topic='wallet', question='how much')))}::jsonb)")
check(a["ok"] and a["version"] == 2 and a["run"]["prefix"] == URL and a["run"]["weights"] == "weights.bin", f"ask gives n8n the files {a}")
check(J(f"SELECT aquaterra_mind({lit(json.dumps(dict(action='ask', session=S['bob'], topic='nope')))}::jsonb)")["error"] == "topic", "topic checked")
psql("UPDATE aquaterra_mind_settings SET value = '2' WHERE key = 'asks_per_hour'")
J(f"SELECT aquaterra_mind({lit(json.dumps(dict(action='ask', session=S['bob'], topic='help')))}::jsonb)")
check(J(f"SELECT aquaterra_mind({lit(json.dumps(dict(action='ask', session=S['bob'], topic='help')))}::jsonb)")["error"] == "too_many", "rate limit")
psql("UPDATE aquaterra_mind_settings SET value = '50' WHERE key = 'asks_per_hour'")
psql("UPDATE aquaterra_mind_settings SET value = '3' WHERE key = 'asks_per_minute_all'")
ask = lambda: J(f"SELECT aquaterra_mind({lit(json.dumps(dict(action='ask', session=S['ann'], topic='help')))}::jsonb)")
check(ask()["ok"] and ask()["error"] == "busy", "city-wide cap on answers a minute")
# experimental: below the exam bar only when the lab asks, and the site sees the label
mind(action="release", key=RKEY, manifest=dict(man, version=3, step=950), prefix=URL)
check(mind(action="promote", key=RKEY, version=3, exam={"total": 30, "passed": 1})["live"] is False, "low exam stays shadow")
r = mind(action="promote", key=RKEY, version=3, exam={"total": 30, "passed": 1}, experimental=True)
st = mind(action="status")
check(r["live"] and r["experimental"] and st["live"]["version"] == 3 and st["live"]["experimental"] is True, f"experimental live {r}")
check([x["status"] for x in st["releases"]][:2] == ["live", "retired"], "previous release retired")
st = mind(action="status")
check(st["data"]["consenting"] == 2 and st["data"]["sent"] >= 8, f"data stats {st['data']}")
print(f"ok, {passed} checks")
