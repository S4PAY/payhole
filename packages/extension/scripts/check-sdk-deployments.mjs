// Refuses to build the extension against an SDK build that has no deployed addresses, so a stale
// workspace build can never ship an extension whose settings default to empty contracts.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { deployments } = await import(require.resolve("@payhole/sdk"));
const missing = ["BudgetAccountFactory", "BurnVault", "CreatorRegistry"].filter((name) => !/^0x[0-9a-fA-F]{40}$/.test(deployments.contracts?.[name]?.address ?? ""));
if (missing.length > 0) {
  console.error(`@payhole/sdk build has no address for: ${missing.join(", ")}. Run "pnpm --filter @payhole/sdk build" first.`);
  process.exit(1);
}
console.log("sdk deployments present:", ["BudgetAccountFactory", "BurnVault", "CreatorRegistry"].map((n) => `${n}=${deployments.contracts[n].address}`).join(" "));
