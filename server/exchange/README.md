# Buying Tide

Rules: `exchange.sql` (one-off migration, safe to run again). Test: `PGHOST=/var/tmp/pg PGPORT=5433 python3 server/exchange/test_exchange.py`.

n8n:
- **[68 PUBLIC] AquaTerra Exchange**, `POST /webhook/aquaterra-exchange`: browser requests go to `aquaterra_exchange()`. For card orders it also talks to Revolut (credential *Revolut Merchant*, Header Auth `Authorization: Bearer sk_…`; the key never lives in code or git).
- **[69 OPS] AquaTerra Payments Watcher**, every 2 minutes: reads Cronos (`evm.cronos.org`) for USDT transfers and native CRO to the project wallet and to market sellers, gets the CRO price from CoinGecko, and calls `aquaterra_exchange_internal('scan_result')`. SQL matches each transfer by exact amount and credits once.

Switches (founder, in /admin): `card_enabled`, `crypto_enabled` (also needs `deposit_address`), `market_enabled`, `token_enabled` (stays 0 until the legal review). The token contract is `contracts/TideToken.sol`, not deployed.

Transfers that match nothing (wrong amount, late) are listed in /admin for the founder to check and grant by hand.
