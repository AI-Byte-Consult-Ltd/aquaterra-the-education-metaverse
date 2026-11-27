// AquaTerra Farms and Harvest Market. The browser sends JSON as text/plain.
// All rules live in the SQL function aquaterra_farm() (server/farm/farm.sql).
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['market', 'book', 'me', 'plant', 'harvest', 'clear', 'reserve', 'order', 'cancel', 'works', 'setup', 'produce', 'dismantle', 'ship', 'city', 'deliver', 'fields'];
const req = { action: actions.includes(b.action) ? b.action : 'invalid' };
const s = String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (s) req.session = s;
if (typeof b.crop === 'string') req.crop = b.crop.replace(/[^a-z]/g, '').slice(0, 20);
if (typeof b.works === 'string') req.works = b.works.replace(/[^a-z]/g, '').slice(0, 20);
if (typeof b.resource === 'string') req.resource = b.resource.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 30);
if (b.side === 'buy' || b.side === 'sell') req.side = b.side;
const int = (v, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 0 && n < max ? String(n) : undefined; };
for (const k of ['plotId', 'orderId', 'units', 'qty']) if (b[k] !== undefined) { const v = int(b[k], 1e15); if (v !== undefined) req[k] = v; }
if (b.price !== undefined) req.price = String(b.price).replace(/[^0-9.]/g, '').slice(0, 9);
return [{ json: { req: JSON.stringify(req) } }];
