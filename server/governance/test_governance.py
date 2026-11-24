"""End-to-end test of the governance functions on a scratch Postgres.

  PGHOST=/var/tmp/pg PGPORT=5433 python3 server/governance/test_governance.py

Creates a fresh database `aquaterra_gov_test`, loads base-tables.sql (a copy
of the account tables), schema.sql, functions.sql, api.sql, then plays a
small Commonwealth through every kind of decision.
"""
import hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DB = "aquaterra_gov_test"
BASE = ["psql", "-U", os.environ.get("PGUSER", "postgres"), "-v", "ON_ERROR_STOP=1", "-q", "-tA"]

def psql(sql, db=DB):
    r = subprocess.run(BASE + ["-d", db, "-c", sql], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {sql[:200]}\n{r.stderr}")
    return r.stdout.strip()

def load(f):
    r = subprocess.run(BASE + ["-d", DB, "-f", os.path.join(HERE, f)], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{f}: {r.stderr}")

def lit(s):
    return "'" + s.replace("'", "''") + "'"

def gov(req):
    return json.loads(psql(f"SELECT aquaterra_gov({lit(json.dumps(req))}::jsonb)"))

def tick(districts=None):
    arg = "NULL" if districts is None else lit(json.dumps(districts)) + "::jsonb"
    return json.loads(psql(f"SELECT aquaterra_gov_tick({arg})"))

def expire(pid):
    psql(f"UPDATE aquaterra_gov_proposals SET stage_ends = now() - interval '1 second' WHERE id = {pid}")

passed = 0
def check(cond, msg):
    global passed
    if not cond:
        raise SystemExit("FAIL: " + msg)
    passed += 1

psql(f"DROP DATABASE IF EXISTS {DB}", db="postgres")
psql(f"CREATE DATABASE {DB}", db="postgres")
for f in ["base-tables.sql", "schema.sql", "functions.sql", "api.sql", "schema.sql", "functions.sql", "api.sql"]:
    load(f)  # twice: the migration must be safe to run again

S = {}
def player(email, name, role="citizen"):
    psql(f"INSERT INTO aquaterra_players (email, display_name, role) VALUES ({lit(email)}, {lit(name) if name else 'NULL'}, {lit(role)})")
    tok = hashlib.sha256(email.encode()).hexdigest()
    psql(f"INSERT INTO aquaterra_sessions (token_hash, email, expires_at) VALUES (encode(sha256(convert_to({lit(tok)}, 'UTF8')), 'hex'), {lit(email)}, now() + interval '1 day')")
    S[name or email] = tok
    return tok

player("founder@x", "Alexander", "founder")
for n in ["Ava", "Ben", "Cleo", "Dan"]:
    player(n.lower() + "@x", n)
psql("INSERT INTO aquaterra_council (seat, name, title, kind, email) VALUES (1, 'Alexander', 'Founder', 'human', 'founder@x'), (2, 'NICS AI', 'City Mind', 'ai', NULL)")

def as_(who, **req):
    req["session"] = S[who]
    return gov(req)

# --- districts arrive from the map
D = [{"id": 0, "name": "First Light City", "biome": "metropolis", "land": "Continent", "capital": True},
     {"id": 1, "name": "Ember Fields", "biome": "volcanic", "land": "Continent"},
     {"id": 2, "name": "Coral Bay", "biome": "tropical", "land": "Oceania"}]
t = tick(D)
check(t["districtsAdded"] == 3, "three districts registered")
t = tick(D + [{"id": 3, "name": "Reedwater", "biome": "wetland", "land": "Greenhaven Isle"}])
check(t["districtsAdded"] == 1, "a new district is added on its own")
check("New district on the map: Reedwater" in psql("SELECT text FROM aquaterra_gov_log ORDER BY id DESC LIMIT 1"), "new district logged")

st = gov({"action": "state"})
check(st["council"]["filled"] == 2 and st["council"]["need"] == 2, "council of two needs both votes")
check(st["assembly"]["founding"] and st["assembly"]["total"] == 51, "founding assembly of 51 seats")

# --- residence
check(psql("SELECT d.name, r.chosen FROM aquaterra_residents r JOIN aquaterra_districts d ON d.id = r.district_id WHERE email = 'ava@x'") == "First Light City|f",
      "a citizen who never chose lives in the capital")
player("eve@x", "Eve")
check(as_("Eve", action="propose", kind="resolution", title="Parks", body="x" * 30)["error"] == "no_home", "no home, no proposal")
me = as_("Eve", action="set_residence", skip=True)
check(me["ok"] and me["home"]["name"] == "First Light City" and me["home"]["chosen"] is False and me["home"]["canMoveAt"] is None,
      "skipping at sign-up: First Light City, free to choose later")
check(as_("Eve", action="set_residence", district=2)["ok"], "the first real choice has no wait")
check(as_("Eve", action="set_residence", district=1)["error"] == "cooldown", "after choosing: 30 days before moving again")
as_("Eve", action="set_residence", skip=True)
check(as_("Eve", action="me")["home"]["name"] == "Coral Bay", "skip later does not move a chosen home")
psql("DELETE FROM aquaterra_residents WHERE email = 'eve@x'; UPDATE aquaterra_players SET display_name = NULL WHERE email = 'eve@x'")  # keep the electorate at five below
tick()
check(psql("SELECT count(*) FROM aquaterra_residents WHERE email = 'eve@x'") == "0", "a player without a name is not made a citizen")
for who, d in [("Alexander", 0), ("Ava", 1), ("Ben", 1), ("Cleo", 1), ("Dan", 2)]:
    check(as_(who, action="set_residence", district=d)["ok"], f"{who} moves in")
check(as_("Ava", action="set_residence", district=2)["error"] == "cooldown", "cannot move again at once")
check(gov({"action": "me", "session": "0" * 64})["error"] == "session", "bad session refused")

# --- a law that changes a number: founder skips signatures
r = as_("Alexander", action="propose", kind="set_param", title="Land tax to 2 percent", payload={"key": "land_tax_pct", "value": 2})
check(r["ok"] and r["proposal"]["status"] == "voting" and r["proposal"]["stageBody"] == "assembly", "official proposal goes straight to the Assembly")
pid = r["proposal"]["id"]
check(as_("Ava", action="vote", id=pid, choice="yes")["ok"], "resident votes in the Founding Assembly")
check(as_("Ben", action="vote", id=pid, choice="no")["ok"], "another votes")
check(as_("Cleo", action="vote", id=pid, choice="maybe")["error"] == "choice", "bad choice refused")
as_("Cleo", action="vote", id=pid, choice="yes")
expire(pid); tick()
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check(p["stageBody"] == "council", "Assembly approved, now the Council")
check(any(v["ai"] and v["choice"] == "yes" for v in p["rollCall"]), "NICS AI voted at once")
check(not as_("Ava", action="proposal", id=pid)["proposal"]["me"]["canVote"], "citizen cannot vote in the Council")
check(as_("Ava", action="vote", id=pid, choice="yes")["error"] == "not_eligible", "council vote refused to citizen")
r = as_("Alexander", action="vote", id=pid, choice="yes")
check(r["proposal"]["status"] == "passed", "two of two: adopted at once")
check(psql("SELECT value FROM aquaterra_gov_params WHERE key='land_tax_pct'") == "2", "law executed: tax is 2")

# --- NICS AI rule E1
r = as_("Alexander", action="propose", kind="set_param", title="Sales tax to 12 percent", payload={"key": "sales_tax_pct", "value": 12})
pid = r["proposal"]["id"]
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check(p["results"][0]["passed"] and p["results"][0]["body"] == "assembly", "all five voted: Assembly closes early")
nics = [v for v in p["rollCall"] if v["ai"]][0]
check(nics["choice"] == "no" and "E1" in nics["reason"], "NICS AI refuses a 9-point tax jump")
check(p["status"] == "rejected", "council of two cannot pass it: closed at once")

# --- citizen petition needs signatures
r = as_("Ava", action="propose", kind="resolution", title="Free ferries", body="Ferries between the islands are free for residents.")
pid = r["proposal"]["id"]
check(r["proposal"]["status"] == "signatures" and r["proposal"]["signatures"]["needed"] == 3, "petition needs 3 signatures")
as_("Ben", action="sign", id=pid)
check(as_("Ben", action="proposal", id=pid)["proposal"]["status"] == "signatures", "two of three")
r = as_("Cleo", action="sign", id=pid)
check(r["proposal"]["status"] == "voting", "third signature opens the vote")

# --- elections: a Mayor once a district has residents
psql("UPDATE aquaterra_gov_params SET value = 3 WHERE key = 'mayor_residents'")
t = tick()
check(t["electionsOpened"] == 1, "mayor election for Ember Fields (3 residents)")
eid = int(psql("SELECT id FROM aquaterra_gov_proposals WHERE kind='election' ORDER BY id DESC LIMIT 1"))
check(as_("Dan", action="stand", id=eid)["error"] == "not_eligible", "only residents of the district stand")
check(as_("Ava", action="stand", id=eid, statement="Lava parks")["ok"], "Ava stands")
check(as_("Ben", action="stand", id=eid, statement="Cheaper rent")["ok"], "Ben stands")
check(as_("Ava", action="vote", id=eid, choice="1")["error"] == "closed", "no voting during nominations")
expire(eid); tick()
check(as_("Ava", action="proposal", id=eid)["proposal"]["stageBody"] == "ballot", "ballot open")
check(as_("Dan", action="vote", id=eid, choice="1")["error"] == "not_eligible", "outsider cannot vote")
as_("Ava", action="vote", id=eid, choice="1"); as_("Cleo", action="vote", id=eid, choice="1"); as_("Ben", action="vote", id=eid, choice="2")
expire(eid); tick()
p = as_("Ava", action="proposal", id=eid)["proposal"]
check(p["status"] == "passed" and "Ava" in p["outcome"], "Ava elected Mayor 2 to 1")
check(any(o["office"] == "mayor" for o in as_("Ava", action="me")["offices"]), "Ava holds the office")
check(as_("Ava", action="set_residence", district=0)["error"] in ("cooldown", "office"), "a Mayor cannot leave")

# --- budget without money: NICS AI rule E2
r = as_("Alexander", action="propose", kind="budget", title="Harbour lights", body="Lights", payload={"amount": 500})
pid = r["proposal"]["id"]
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check([v for v in p["rollCall"] if v["ai"]][0]["reason"].startswith("Rule E2"), "NICS AI: treasury too small")

# --- charter: entrenched seats
r = as_("Alexander", action="propose", kind="charter", title="Amend Article 1", body="Remove the permanent seat of NICS AI from the Council.")
pid = r["proposal"]["id"]
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check([v for v in p["rollCall"] if v["ai"]][0]["choice"] == "no", "NICS AI defends Article 1")

# --- skyscraper: district vote, Assembly, Council
r = as_("Alexander", action="propose", kind="skyscraper", title="Ember Spire", body="", payload={"district": 1, "address": "1 Lava Road", "floors": 30})
check(r["error"] == "floors", "30 floors is not a skyscraper")
r = as_("Alexander", action="propose", kind="skyscraper", title="Ember Spire", body="", payload={"district": 1, "address": "1 Lava Road", "floors": 64})
pid = r["proposal"]["id"]
check(r["proposal"]["stageBody"] == "district", "residents of Ember Fields vote first")
check(as_("Dan", action="vote", id=pid, choice="yes")["error"] == "not_eligible", "only that district")
for w in ["Ava", "Ben", "Cleo"]:
    as_(w, action="vote", id=pid, choice="yes")
check(as_("Ava", action="proposal", id=pid)["proposal"]["stageBody"] == "assembly", "then the Assembly")
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
r = as_("Alexander", action="vote", id=pid, choice="yes")
check(r["proposal"]["status"] == "passed", "tower approved")
check(psql("SELECT count(*) FROM aquaterra_gov_projects WHERE kind='skyscraper' AND status='approved'") == "1", "permit issued")
check(as_("Ava", action="mark_built", project=1)["error"] == "forbidden", "only Works marks built")
check(as_("Alexander", action="mark_built", project=1)["ok"], "founder acts for empty Works post")

# --- merge Coral Bay into Ember Fields: Mayors, Assembly 3/5, Council, referendum
r = as_("Alexander", action="propose", kind="district_merge", title="Join Coral Bay and Ember Fields", body="",
        payload={"district": 2, "into": 1, "name": "Ember Coast"})
pid = r["proposal"]["id"]
check(r["proposal"]["stageBody"] == "mayors", "Conference of Mayors gives its opinion")
as_("Ava", action="vote", id=pid, choice="yes")
check(as_("Ava", action="proposal", id=pid)["proposal"]["stageBody"] == "assembly", "one mayor, opinion recorded")
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
as_("Alexander", action="vote", id=pid, choice="yes")
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check(p["stageBody"] == "referendum", "residents of both districts decide")
check(as_("Alexander", action="vote", id=pid, choice="yes")["error"] == "not_eligible", "capital resident has no say")
for w in ["Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
check(as_("Ava", action="proposal", id=pid)["proposal"]["status"] == "passed", "merged")
check(psql("SELECT merged_into FROM aquaterra_districts WHERE id=2") == "1", "Coral Bay governed by Ember Fields")
ds = {d["id"]: d for d in gov({"action": "districts"})["districts"]}
check(ds[1]["totalResidents"] == 4 and ds[2]["governedBy"] == "Ember Coast", "residents add up, new name")

# --- appoint a Director, who then pays from a budget
r = as_("Alexander", action="propose", kind="appoint_director", title="Ben for Treasury", payload={"post": "treasury", "name": "ben"})
pid = r["proposal"]["id"]
check("email" not in r["proposal"]["payload"], "no email in public payload")
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"]:
    as_(w, action="vote", id=pid, choice="yes")
as_("Alexander", action="vote", id=pid, choice="yes")
check(psql("SELECT holder_email FROM aquaterra_gov_directorate WHERE post='treasury'") == "ben@x", "Ben is Director of Treasury")
check(as_("Alexander", action="disburse", line=1, to="Ava", amount=1)["error"] == "forbidden", "founder no longer acts for a filled post")

# --- the Assembly fills up: district seats appear by themselves, lot seats are drawn
for i in range(12):
    player(f"r{i}@x", f"Res{i}")
    as_(f"Res{i}", action="set_residence", district=3)
psql("UPDATE aquaterra_gov_params SET value = 10 WHERE key = 'district_seat_residents'")
psql("UPDATE aquaterra_gov_params SET value = 5 WHERE key = 'lot_residents_per_seat'")
t = tick()
check(t["seatsAdded"] == 1, "Reedwater reached 10 residents: a seat")
check(psql("SELECT count(*) FROM aquaterra_gov_seats WHERE kind='lot' AND holder_email IS NOT NULL") == "3", "17 residents: 3 lot seats drawn")
check(psql("SELECT count(*) FROM aquaterra_gov_proposals WHERE kind='election' AND payload->>'office'='deputy' AND status='voting'") == "1", "deputy election opened")
check(psql("SELECT count(*) FROM aquaterra_gov_proposals WHERE kind='election' AND payload->>'office'='council' AND status='voting'") == "0", "17 < 20: no council election yet")
for i in range(3):
    player(f"s{i}@x", f"New{i}")
    as_(f"New{i}", action="set_residence", district=0)
t = tick()
cid = int(psql("SELECT id FROM aquaterra_gov_proposals WHERE kind='election' AND payload->>'office'='council' AND status='voting'"))
check("9 seats" in as_("Ava", action="proposal", id=cid)["proposal"]["title"], "council election for 9 seats")
for w in ["Ava", "Ben", "Res0"]:
    as_(w, action="stand", id=cid)
check(as_("Alexander", action="stand", id=cid)["error"] == "not_eligible", "permanent member does not stand")
expire(cid); tick()
check(psql("SELECT count(*) FROM aquaterra_council WHERE seat > 2 AND email IS NOT NULL") == "3", "three elected unopposed")
st = gov({"action": "state"})
check(st["council"]["filled"] == 5 and st["council"]["need"] == 4, "council of five needs four")

# --- log has no emails
logtext = json.dumps(gov({"action": "log"}))
check("@x" not in logtext, "journal has no emails")
check("@x" not in json.dumps(gov({"action": "state"})) and "@x" not in json.dumps(gov({"action": "proposals", "filter": "all"})), "public answers have no emails")
laws = gov({"action": "laws"})
check(len(laws["laws"]) >= 1 and laws["projects"][0]["status"] == "built", "statute book and works")

# --- money: a stub of the TIDE ledger (the real one belongs to the economy workflow)
psql("""CREATE TABLE aquaterra_wallets (account text PRIMARY KEY, balance bigint NOT NULL DEFAULT 0);
CREATE TABLE aquaterra_plot_owners (plot_id int PRIMARY KEY, owner text, price_paid bigint, bought_at timestamptz);
CREATE FUNCTION aquaterra_tide_transfer(f text, t text, amount bigint, memo text, ref text) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  UPDATE aquaterra_wallets SET balance = balance - amount WHERE account = f AND balance >= amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'insufficient'; END IF;
  INSERT INTO aquaterra_wallets VALUES (t, amount) ON CONFLICT (account) DO UPDATE SET balance = aquaterra_wallets.balance + amount;
  RETURN 1;
END $$;
INSERT INTO aquaterra_wallets VALUES ('state:treasury', 10000), ('dan@x', 5), ('cleo@x', 100000);
INSERT INTO aquaterra_plot_owners VALUES (1, 'cleo@x', 365000, now() - interval '40 days'), (2, 'dan@x', 365000, now() - interval '40 days');""")
r = as_("Alexander", action="propose", kind="budget", title="Ferry fund", body="Ferries", payload={"amount": 2000})
pid = r["proposal"]["id"]
for w in ["Alexander", "Ava", "Ben", "Cleo", "Dan"] + [f"Res{i}" for i in range(12)] + [f"New{i}" for i in range(3)]:
    as_(w, action="vote", id=pid, choice="yes")
for w in ["Alexander", "Ava", "Ben"]:
    as_(w, action="vote", id=pid, choice="yes")
p = as_("Alexander", action="proposal", id=pid)["proposal"]
check(p["status"] == "passed" and "2000 TIDE moved" in p["outcome"], "budget law funded from the treasury: " + str(p["outcome"]))
line = int(psql(f"SELECT id FROM aquaterra_gov_budget WHERE proposal_id = {pid}"))
check(as_("Ben", action="disburse", line=line, to="Ava", amount=3000)["error"] == "funds", "cannot pay more than the line")
check(as_("Ben", action="disburse", line=line, to="Ava", amount=300, memo="Ferry pilot")["ok"], "Director of Treasury pays")
check(psql("SELECT balance FROM aquaterra_wallets WHERE account='ava@x'") == "300", "Ava received 300 TIDE")
check(psql(f"SELECT spent FROM aquaterra_gov_budget WHERE id={line}") == "300", "spent recorded")
tick()
check(psql("SELECT collected, payers, unpaid FROM aquaterra_gov_tax_runs") == "600|1|1", "land tax: 2% a year of 365000 for 30 days = 600; Dan cannot pay")

# --- terms end: the seat empties and a new election opens
psql("UPDATE aquaterra_council SET term_ends = now() - interval '1 minute' WHERE seat = 3")
psql("UPDATE aquaterra_gov_proposals SET closed_at = now() - interval '2 days' WHERE kind = 'election' AND payload->>'office' = 'council'")
tick()
check(psql("SELECT count(*) FROM aquaterra_council WHERE seat = 3") == "0", "ended council term frees the seat")
check(psql("SELECT count(*) FROM aquaterra_gov_proposals WHERE kind='election' AND payload->>'office'='council' AND status='voting'") == "1", "and a new council election opens")

print(f"ok: {passed} checks passed")
