// n8n Code node "Build Call": ownerOf(tokenId) as eth_call data.
const c = $input.first().json.r.check;
const id = BigInt(c.tokenId).toString(16).padStart(64, '0');
return [{ json: { check: c, body: { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: c.contract, data: '0x6352211e' + id }, 'latest'] } } }];
