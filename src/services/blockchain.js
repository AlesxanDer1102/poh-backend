import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ethers } from 'ethers';
import { config, chainConfigured } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const abi = JSON.parse(readFileSync(join(__dirname, '../abi/ProofOfHumanity.json'), 'utf8'));

let provider;
let wallet;
let contract;

/** Lazily build the ethers contract. Returns null if chain env is not configured. */
function getContract() {
  if (!chainConfigured()) return null;
  if (!contract) {
    provider = new ethers.JsonRpcProvider(config.chain.rpcUrl);
    wallet = new ethers.Wallet(config.chain.validatorKey, provider);
    contract = new ethers.Contract(config.chain.contractAddress, abi, wallet);
  }
  return contract;
}

/**
 * Derive a non-reversible humanity hash from the user address and biometric descriptor.
 * keccak256(abi.encode(address, keccak256(descriptorBytes))).
 */
export function deriveHumanityHash(address, faceDescriptor) {
  const descriptorBytes = ethers.toUtf8Bytes(JSON.stringify(faceDescriptor));
  const descriptorHash = ethers.keccak256(descriptorBytes);
  return ethers.solidityPackedKeccak256(['address', 'bytes32'], [address, descriptorHash]);
}

/**
 * Register a humanity proof on-chain and measure gas + confirmation time.
 * @returns {{ txHash: string, gasUsed: string, confirmationMs: number }}
 */
export async function registerProof(address, humanityHash) {
  const c = getContract();
  if (!c) throw new Error('chain_not_configured');

  const t0 = Date.now();
  const tx = await c.registerProof(address, humanityHash);
  const receipt = await tx.wait();
  const confirmationMs = Date.now() - t0;

  return {
    txHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    confirmationMs,
  };
}

/** Read verification status for an address. */
export async function isHuman(address) {
  const c = getContract();
  if (!c) throw new Error('chain_not_configured');
  return c.isHuman(address);
}

/** Read the full proof for an address. */
export async function getProof(address) {
  const c = getContract();
  if (!c) throw new Error('chain_not_configured');
  const [humanityHash, timestamp, validator, verified] = await c.getProof(address);
  return {
    humanityHash,
    timestamp: Number(timestamp),
    validator,
    verified,
  };
}

export { chainConfigured };
