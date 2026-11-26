// n8n Code node "Read Owner": the owner address from the eth_call answer, or null.
// ERC-1155: the answer is a batch of balanceOf; the owner is the first listed holder with a balance.
const c = $('Build Call').first().json.check;
const r = $input.first().json || {};
let owner = null;
if (c.standard === 'erc1155') {
  const arr = Array.isArray(r) ? r : Array.isArray(r.data) ? r.data : $input.all().map((x) => x.json);
  let answered = false;
  for (const a of arr) {
    if (!a || typeof a.result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(a.result)) continue;
    answered = true;
    if (BigInt(a.result) > 0n && c.holders[a.id]) { owner = c.holders[a.id]; break; }
  }
  // Answered but held by none of them: an owner that is not ours, so the server says not_owner / not_received.
  if (!owner && answered) owner = '0x000000000000000000000000000000000000dead';
} else {
  const h = typeof r.result === 'string' ? r.result : '';
  owner = /^0x[0-9a-fA-F]{64}$/.test(h) && !/^0x0{64}$/.test(h) ? '0x' + h.slice(26).toLowerCase() : null;
}
return [{ json: { req: JSON.stringify({ action: 'owner', swapId: c.swapId, step: c.step, owner }) } }];
