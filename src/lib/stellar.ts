import { Horizon, Networks } from "@stellar/stellar-sdk";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

export const server = new Horizon.Server(HORIZON_URL);

export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * Funds a testnet account via Friendbot. Only works on testnet.
 */
export async function fundTestnetAccount(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Friendbot funding failed for ${publicKey}: ${body}`);
  }
}
