// Where the reporter key and the linked proof live: the key in the device keystore through SecureStore,
// the proof next to it. Nothing here leaves the phone.

import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { bytesToHexString, hexToBytesArray, isPrivateKey, type Proof } from "./identity";

const KEY_ITEM = "payhole.reporter.key";
const PROOF_ITEM = "payhole.reporter.proof";

/** The phone's reporter key, created on first use. */
export async function loadOrCreateKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(KEY_ITEM);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) {
    const key = hexToBytesArray(stored);
    if (isPrivateKey(key)) return key;
  }
  let key = getRandomBytes(32);
  while (!isPrivateKey(key)) key = getRandomBytes(32);
  await SecureStore.setItemAsync(KEY_ITEM, bytesToHexString(key));
  return key;
}

export async function loadProof(): Promise<Proof | null> {
  const stored = await SecureStore.getItemAsync(PROOF_ITEM);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<Proof>;
    if (typeof value.peerId === "string" && typeof value.address === "string" && typeof value.issuedAt === "string" && typeof value.signature === "string") {
      return { peerId: value.peerId, address: value.address, issuedAt: value.issuedAt, signature: value.signature };
    }
  } catch {
    // a broken proof is the same as none
  }
  return null;
}

export async function saveProof(proof: Proof | null): Promise<void> {
  if (proof) await SecureStore.setItemAsync(PROOF_ITEM, JSON.stringify(proof));
  else await SecureStore.deleteItemAsync(PROOF_ITEM);
}
