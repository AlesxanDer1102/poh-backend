import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  env: process.env.NODE_ENV ?? 'development',
  chain: {
    rpcUrl: process.env.SEPOLIA_RPC_URL ?? '',
    validatorKey: process.env.VALIDATOR_PRIVATE_KEY ?? '',
    contractAddress: process.env.CONTRACT_ADDRESS ?? '',
  },
  db: {
    url: process.env.DATABASE_URL ?? 'postgres://poh:poh@localhost:5432/poh',
  },
  faceMatchThreshold: Number(process.env.FACE_MATCH_THRESHOLD ?? 0.6),
};

/** True when blockchain env vars are fully configured. */
export const chainConfigured = () =>
  Boolean(config.chain.rpcUrl && config.chain.validatorKey && config.chain.contractAddress);
