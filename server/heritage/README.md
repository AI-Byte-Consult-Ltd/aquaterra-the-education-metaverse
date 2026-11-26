# Heritage Port: old NFTs come home

Rules: `heritage.sql` (one-off migration, safe to run again). Tests:
`PGHOST=/var/tmp/pg PGPORT=5433 python3 server/heritage/test_heritage.py` and `node server/heritage/verify-check.cjs`.

n8n **[71 PUBLIC] AquaTerra Heritage**, `POST /webhook/aquaterra-heritage`. Its Code nodes are built from
`verify.cjs` + `validate.js`, `chain.js`, `owner.js` by `python3 server/heritage/build-workflow.py` (template
`workflow.tpl.js`). Signature recovery (personal_sign: Keccak-256 + secp256k1) runs in the Code node without
libraries; ownership is `ownerOf(token)` over the public RPC of the chain stored in `aquaterra_nft_chains`.

Networks: Cronos, Polygon, Ethereum on; Bitcoin listed, off until its collections and a signature check are added.
Only ERC-721 for now. Collections are listed and switched on by the Founder in /admin.
