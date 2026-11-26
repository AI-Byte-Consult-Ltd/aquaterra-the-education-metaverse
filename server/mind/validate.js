// AquaTerra City Mind. The browser and the NICS lab send JSON as text/plain.
// All rules live in the SQL function aquaterra_mind() (server/mind/mind.sql).
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['status', 'ask', 'release', 'promote', 'retire', 'corpus'];
const req = { action: actions.includes(b.action) ? b.action : 'invalid' };
const key = String(b.key || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (key) req.key = key;
const int = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? String(n) : undefined; };
if (b.version !== undefined) req.version = int(b.version, 999999);
if (b.after !== undefined) req.after = int(b.after, 1e15);
if (b.limit !== undefined) req.limit = int(b.limit, 2000);
if (b.civic === true) req.civic = 'true';
if (b.experimental === true) req.experimental = 'true';
if (typeof b.prefix === 'string') req.prefix = b.prefix.slice(0, 300);
const sess = String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (sess) req.session = sess;
if (typeof b.topic === 'string') req.topic = b.topic.replace(/[^a-z_]/g, '').slice(0, 20);
if (typeof b.question === 'string') req.question = b.question.replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
if (b.exam && typeof b.exam === 'object') req.exam = { total: int(b.exam.total, 99999), passed: int(b.exam.passed, 99999) };
if (req.action === 'release' && b.manifest && typeof b.manifest === 'object' && JSON.stringify(b.manifest).length < 200000) req.manifest = b.manifest;
return [{ json: { req: JSON.stringify(req) } }];
