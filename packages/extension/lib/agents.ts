import type { Address, Hex, PublicClient } from "viem";
import { readSessionKey } from "@payhole/sdk";
import type { KeyValueStore } from "./storage";

export const AGENTS_KEY = "agents";

export interface AgentRecord {
  index: number;
  address: Address;
  label: string;
  createdAt: number;
  revokedAt?: number;
}

export interface AgentView extends AgentRecord {
  live: boolean;
  cap: string;
  spent: string;
  remaining: string;
  expiry: number;
}

interface StoredAgents {
  nextIndex: number;
  records: AgentRecord[];
}

/** Labels and derivation indexes live locally; caps, expiries, and liveness are read from the chain. */
export class AgentStore {
  private data: StoredAgents = { nextIndex: 0, records: [] };

  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<void> {
    const stored = await this.store.get<Partial<StoredAgents>>(AGENTS_KEY);
    this.data = { nextIndex: stored?.nextIndex ?? 0, records: stored?.records ?? [] };
  }

  list(): AgentRecord[] {
    return [...this.data.records];
  }

  find(address: Address): AgentRecord | undefined {
    return this.data.records.find((r) => r.address.toLowerCase() === address.toLowerCase());
  }

  nextIndex(): number {
    return this.data.nextIndex;
  }

  async add(record: AgentRecord): Promise<void> {
    this.data.records = [...this.data.records.filter((r) => r.index !== record.index), record];
    this.data.nextIndex = Math.max(this.data.nextIndex, record.index + 1);
    await this.store.set(AGENTS_KEY, this.data);
  }

  async update(index: number, patch: Partial<AgentRecord>): Promise<void> {
    this.data.records = this.data.records.map((r) => (r.index === index ? { ...r, ...patch } : r));
    await this.store.set(AGENTS_KEY, this.data);
  }

  async markAllRevoked(at: number): Promise<void> {
    this.data.records = this.data.records.map((r) => ({ ...r, revokedAt: r.revokedAt ?? at }));
    await this.store.set(AGENTS_KEY, this.data);
  }
}

/** The exact environment the `payhole` CLI reads. */
export function exportEnv(privateKey: Hex, budgetAccount: string): string {
  return `PAYHOLE_SESSION_KEY=${privateKey}\nPAYHOLE_BUDGET_ACCOUNT=${budgetAccount}\n`;
}

export async function readAgentViews(client: PublicClient, budgetAccount: Address, records: readonly AgentRecord[]): Promise<AgentView[]> {
  return Promise.all(
    records.map(async (record) => {
      const state = await readSessionKey(client, budgetAccount, record.address);
      return {
        ...record,
        live: state.live,
        cap: state.cap.toString(),
        spent: state.spent.toString(),
        remaining: state.remaining.toString(),
        expiry: state.expiry,
      };
    }),
  );
}

export function countLive(views: readonly AgentView[]): number {
  return views.filter((v) => v.live).length;
}
