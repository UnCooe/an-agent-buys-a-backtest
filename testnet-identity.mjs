import { BlockHash } from "@concordium/web-sdk";
import { ConcordiumGRPCNodeClient, credentials } from "@concordium/web-sdk/nodejs";
import { CONCORDIUM_TESTNET_CAIP2 } from "@x402/concordium";

export const grpc = new ConcordiumGRPCNodeClient(
  "grpc.testnet.concordium.com", 20000, credentials.createSsl(), { timeout: 10_000 },
);
export const walletPath = process.env.CONCORDIUM_TESTNET_WALLET;

export async function checkNetwork() {
  const consensus = await grpc.getConsensusStatus();
  const genesis = BlockHash.toHexString(consensus.genesisBlock);
  if ("ccd:" + genesis.slice(0, 32) !== CONCORDIUM_TESTNET_CAIP2) {
    throw new Error("Unexpected genesis. Aborting.");
  }
}

export async function checkedFetch(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(15_000), ...options });
}
