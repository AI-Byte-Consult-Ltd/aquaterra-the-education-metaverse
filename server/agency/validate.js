// AquaTerra First Light Realty, sales to the state and harvest barter. The browser sends JSON as text/plain.
// All rules live in the SQL function aquaterra_agency() (server/agency/agency.sql).
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['list', 'mine', 'appraise', 'sell_state', 'list_add', 'list_cancel', 'buy', 'barter', 'barter_offer', 'barter_take', 'barter_cancel'];
const req = { action: actions.includes(b.action) ? b.action : 'invalid' };
const s = String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (s) req.session = s;
const kinds = ['plot', 'road', 'apartment', 'planet', 'companion'];
if (kinds.includes(b.kind)) req.kind = b.kind;
if (b.ref !== undefined) req.ref = String(b.ref).replace(/[^a-z0-9:._-]/gi, '').slice(0, 80);
for (const k of ['give', 'want']) if (typeof b[k] === 'string') req[k] = b[k].replace(/[^a-z]/g, '').slice(0, 20);
const int = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 && n < max ? String(n) : undefined; };
for (const k of ['id', 'plotId', 'price', 'giveUnits', 'wantUnits']) if (b[k] !== undefined) { const v = int(b[k], 1e12); if (v !== undefined) req[k] = v; }
return [{ json: { req: JSON.stringify(req) } }];
