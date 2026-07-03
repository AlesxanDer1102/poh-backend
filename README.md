# poh-backend

Off-chain validation orchestrator and REST API for the hybrid Proof of Humanity system.
Node.js + Express + Ethers.js + PostgreSQL.

## Responsibilities

- Receive the face descriptor + liveness result from the frontend and apply trust checks.
- Derive a non-reversible `humanityHash` and register it on-chain via the validator wallet.
- Persist metrics (validation time, gas, confirmation time) in PostgreSQL.
- Expose verification and aggregate metrics.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + config status |
| `POST` | `/api/validate` | Validate + register proof on-chain |
| `GET`  | `/api/verify/:address` | Read verification status + proof |
| `GET`  | `/api/metrics` | Aggregate metrics |

## Setup

```bash
npm install
cp .env.example .env      # fill RPC, VALIDATOR_PRIVATE_KEY, CONTRACT_ADDRESS, DATABASE_URL

# PostgreSQL via Docker (no local psql needed):
docker run --name poh-db -e POSTGRES_USER=poh -e POSTGRES_PASSWORD=poh \
  -e POSTGRES_DB=poh -p 5432:5432 -d postgres:16

npm run db:init          # create tables
npm start                # start API on :4000
```

The server starts even without the chain or DB configured (health reports what is ready),
so you can develop incrementally. `POST /api/validate` registers on-chain only once
`SEPOLIA_RPC_URL`, `VALIDATOR_PRIVATE_KEY` and `CONTRACT_ADDRESS` are set and the validator
wallet is authorized in the contract.
