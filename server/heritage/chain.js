// n8n Code node "Build Call": ownerOf(tokenId) as eth_call data, or for ERC-1155 (no ownerOf)
// a batch of balanceOf(holder, tokenId) for the addresses the server listed.
const c = $input.first().json.r.check;
const id = BigInt(c.tokenId).toString(16).padStart(64, '0');
const call = (n, data) => ({ jsonrpc: '2.0', id: n, method: 'eth_call', params: [{ to: c.contract, data }, 'latest'] });
if (c.standard === 'erc1155') {
  const hs = (c.holders || []).filter((h) => /^0x[0-9a-f]{40}$/.test(h)).slice(0, 10);
  const body = hs.length ? hs.map((h, i) => call(i, '0x00fdd58e' + h.slice(2).padStart(64, '0') + id)) : [call(0, '0x00fdd58e' + '0'.repeat(64) + id)];
  return [{ json: { check: { ...c, holders: hs }, body } }];
}
return [{ json: { check: c, body: call(1, '0x6352211e' + id) } }];
