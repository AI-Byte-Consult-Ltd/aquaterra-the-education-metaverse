// n8n Code node "Validate Heritage" (after the text of verify.cjs). The browser sends JSON as text/plain.
// Rules live in aquaterra_heritage() (server/heritage/heritage.sql). This node only cleans the
// request and, for link and wallet_login, recovers the signer: req.verified is set here only.
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['info', 'me', 'link_challenge', 'link', 'unlink', 'login_challenge', 'wallet_login', 'swap', 'confirm', 'cancel',
  'admin', 'admin_collection', 'admin_setting', 'admin_reserve'];
const req = { action: actions.includes(b.action) ? b.action : 'invalid' };
const s = String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64);
if (s) req.session = s;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
if (typeof b.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(b.address)) req.address = b.address.toLowerCase();
else if (b.address !== undefined) req.address = 'bad';
for (const k of ['collectionId', 'swapId']) { const n = Math.trunc(Number(b[k])); if (Number.isFinite(n) && n > 0 && n < 1e12) req[k] = n; }
if (typeof b.tokenId === 'string' || typeof b.tokenId === 'number') req.tokenId = String(b.tokenId).slice(0, 80);
if (b.choice === 'plot' || b.choice === 'tide') req.choice = b.choice;
if (req.action.startsWith('admin_')) {
  for (const k of ['chain', 'contract', 'name', 'kind', 'note', 'key', 'value']) { const v = str(b[k], 200); if (v !== undefined) req[k] = v; }
  if (b.swapTide !== undefined) { const n = Math.trunc(Number(b.swapTide)); if (Number.isFinite(n)) req.swapTide = n; }
  for (const k of ['allowPlot', 'enabled']) if (typeof b[k] === 'boolean') req[k] = b[k];
}
if (req.action === 'link' || req.action === 'wallet_login') {
  const message = str(b.message, 600), signature = str(b.signature, 140);
  let address = null;
  try { address = recoverPersonal(message, signature); } catch (e) { address = null; }
  if (address) req.verified = { address, message };
}
return [{ json: { req: JSON.stringify(req) } }];
