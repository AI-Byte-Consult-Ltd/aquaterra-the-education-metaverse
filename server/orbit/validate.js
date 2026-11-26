// AquaTerra Orbit. The browser sends JSON as text/plain.
// All rules live in the SQL function aquaterra_orbit() (server/orbit/orbit.sql).
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['sky', 'body', 'me', 'mine', 'sell'];
const req = { action: actions.includes(b.action) ? b.action : 'invalid' };
const s = String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (s) req.session = s;
if (typeof b.name === 'string') req.name = b.name.replace(/[^\p{L}\p{N} ()'.\-\/]/gu, '').slice(0, 60);
if (typeof b.resource === 'string') req.resource = b.resource.replace(/[^\p{L}\p{N} \-]/gu, '').slice(0, 30);
if (b.units !== undefined) { const n = Math.trunc(Number(b.units)); if (Number.isFinite(n) && n > 0 && n < 1e12) req.units = String(n); }
return [{ json: { req: JSON.stringify(req) } }];
