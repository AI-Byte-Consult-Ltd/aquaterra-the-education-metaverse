// n8n Code node "Read Owner": the owner address from the eth_call answer, or null.
const c = $('Build Call').first().json.check;
const r = $input.first().json || {};
const h = typeof r.result === 'string' ? r.result : '';
const owner = /^0x[0-9a-fA-F]{64}$/.test(h) && !/^0x0{64}$/.test(h) ? '0x' + h.slice(26).toLowerCase() : null;
return [{ json: { req: JSON.stringify({ action: 'owner', swapId: c.swapId, step: c.step, owner }) } }];
