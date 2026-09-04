import { useState } from "react";
import { formatUnits } from "viem";
import { useAction, useApi } from "@/components/hooks";
import { ActionStatus, Address, AmountField, CopyButton, Notice, Panel, Usdg } from "@/components/ui";
import { formatUsdg, parseUsdg, toBigint } from "@/lib/format";
import { call } from "@/lib/rpc";

export function Budget() {
  const view = useApi("budget:view", {});
  const action = useAction(view.reload);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [globalCap, setGlobalCap] = useState("");

  if (view.error) return <Notice kind="error">{view.error}</Notice>;
  if (!view.data) return <p className="muted">Loading...</p>;
  const data = view.data;

  return (
    <>
      <ActionStatus action={action} />
      <Panel title="Account">
        <dl className="grid">
          <dt>Owner</dt>
          <dd className="row">
            <Address value={data.owner} short={false} />
            <CopyButton text={data.owner} />
          </dd>
          <dt>Owner ETH</dt>
          <dd>{formatUnits(toBigint(data.ownerEth), 18)} ETH {toBigint(data.ownerEth) === 0n ? <span className="warn">(needs a little ETH for gas)</span> : null}</dd>
          <dt>Owner USDG</dt>
          <dd><Usdg value={data.ownerUsdg} /></dd>
          <dt>BudgetAccount</dt>
          <dd className="row">
            {data.configured ? (
              <>
                <Address value={data.budgetAccount} short={false} />
                <CopyButton text={data.budgetAccount} />
                {!data.exists ? <span className="danger">not found on this chain</span> : null}
              </>
            ) : (
              <>
                <span className="muted">not created</span>
                {data.predicted ? <span className="mono">will be {data.predicted}</span> : null}
                <button type="button" className="primary" disabled={action.busy} onClick={() => action.run(async () => `created ${(await call("budget:createAccount", {})).account}`)}>
                  Create account
                </button>
              </>
            )}
          </dd>
          <dt>Account USDG</dt>
          <dd><Usdg value={data.accountUsdg} /></dd>
          <dt>Agent global cap</dt>
          <dd>
            {formatUsdg(toBigint(data.globalSpent))} spent of <Usdg value={data.globalCap} /> (epoch {data.epoch}, tier limit <Usdg value={data.tierGlobalCap} />)
          </dd>
          <dt>Site payments</dt>
          <dd>
            {formatUsdg(toBigint(data.ledgerTotal))} total, {formatUsdg(toBigint(data.ledgerToday))} today, prompt above <Usdg value={data.extensionGlobalCap} />
          </dd>
        </dl>
        <p className="muted">Direct transfers of USDG to the BudgetAccount address also count as deposits.</p>
      </Panel>
      {data.configured ? (
        <>
          <Panel title="Top up">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                action.run(async () => {
                  const result = await call("budget:topUp", { amount: parseUsdg(topUpAmount).toString() });
                  setTopUpAmount("");
                  const fee = toBigint(result.fee) > 0n ? `, ${formatUsdg(toBigint(result.fee))} burned through the vault` : result.feeSkipped ? `, fee skipped: ${result.feeSkipped}` : "";
                  return `deposited ${formatUsdg(toBigint(result.deposited))}${fee}`;
                });
              }}
            >
              <AmountField label="Amount (USDG)" value={topUpAmount} onChange={setTopUpAmount} />
              <button type="submit" className="primary" disabled={action.busy}>Top up</button>
            </form>
          </Panel>
          <Panel title="Withdraw">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                action.run(async () => {
                  const result = await call("budget:withdraw", { amount: parseUsdg(withdrawAmount).toString(), ...(withdrawTo ? { to: withdrawTo } : {}) });
                  setWithdrawAmount("");
                  return `withdrawn in ${result.txHash}`;
                });
              }}
            >
              <AmountField label="Amount (USDG)" value={withdrawAmount} onChange={setWithdrawAmount} />
              <label>
                To (default: owner)
                <input type="text" value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} placeholder="0x..." />
              </label>
              <button type="submit" disabled={action.busy}>Withdraw</button>
            </form>
          </Panel>
          <Panel title="Agent global cap">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                action.run(async () => {
                  const result = await call("budget:setGlobalCap", { cap: parseUsdg(globalCap).toString() });
                  return `global cap set in ${result.txHash}`;
                });
              }}
            >
              <AmountField label="Cap shared by all agent keys (USDG)" value={globalCap} onChange={setGlobalCap} />
              <button type="submit" disabled={action.busy}>Set cap</button>
            </form>
          </Panel>
        </>
      ) : null}
    </>
  );
}
