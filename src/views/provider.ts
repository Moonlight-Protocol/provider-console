import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import {
  getTransactionDetail,
  getTreasury,
  getUtxos,
  listPps,
  type MembershipInfo,
  type PpInfo,
  type TransactionDetail,
  type TreasuryData,
  type UtxoInfo,
} from "../lib/api.ts";
import { getRouteParams, navigate, onCleanup } from "../lib/router.ts";
import {
  EventsClient,
  type ProviderEvent,
} from "../lib/events-client.ts";
import { getConnectedAddress, signTransaction } from "../lib/wallet.ts";
import { buildFundTx, submitHorizonTx } from "../lib/stellar.ts";

const ITEM_FADE_OUT_MS = 300;
const KEEP_LAST_HISTORICAL = 30;

function truncate(s: string, head = 6, tail = 4): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

function flag(code: string): string {
  return code.toUpperCase().replace(
    /./g,
    (c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65),
  );
}

function flags(codes: string[]): string {
  return codes.map((c) =>
    `<span title="${escapeHtml(c)}" style="font-size:1.1rem">${flag(c)}</span>`
  ).join(" ");
}

function mergedJurisdictions(m: MembershipInfo): string[] {
  return Array.from(
    new Set([
      ...(m.councilJurisdictions ?? []),
      ...(m.claimedJurisdictions ?? []),
    ].map((c) => c.toUpperCase())),
  );
}

function pickPrimaryChannel(memberships: MembershipInfo[]): string | null {
  for (const m of memberships) {
    if (m.status === "ACTIVE" && m.channels[0]) {
      return m.channels[0].channelContractId;
    }
  }
  return null;
}

function fmtAmountStroops(stroops: string): string {
  const big = BigInt(stroops);
  const whole = big / 10_000_000n;
  const frac = big % 10_000_000n;
  return `${whole}.${frac.toString().padStart(7, "0").slice(0, 2)}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

function withBriefCopyFeedback(btn: HTMLElement): void {
  const orig = btn.innerHTML;
  btn.innerHTML =
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  setTimeout(() => {
    btn.innerHTML = orig;
  }, 1200);
}

async function renderContent(): Promise<HTMLElement> {
  const root = document.createElement("div");
  const ppPublicKey = getRouteParams().pk;

  if (!ppPublicKey) {
    navigate("/404");
    return root;
  }

  root.innerHTML =
    `<div style="color:var(--text-muted);margin:2rem 0">Loading provider…</div>`;

  let pps: PpInfo[];
  try {
    pps = await listPps();
  } catch (err) {
    root.innerHTML = `<p class="error-text">${
      escapeHtml(err instanceof Error ? err.message : String(err))
    }</p>`;
    return root;
  }

  const pp = pps.find((p) => p.publicKey === ppPublicKey);
  if (!pp) {
    navigate("/404");
    return root;
  }

  const memberships = pp.councilMemberships;
  const primaryChannelId = pickPrimaryChannel(memberships);

  const [treasuryRes, utxosRes] = await Promise.allSettled([
    getTreasury(ppPublicKey),
    primaryChannelId
      ? getUtxos(ppPublicKey, primaryChannelId)
      : Promise.resolve([] as UtxoInfo[]),
  ]);

  const treasury: TreasuryData | null = treasuryRes.status === "fulfilled"
    ? treasuryRes.value
    : null;
  const initialUtxos: UtxoInfo[] = utxosRes.status === "fulfilled"
    ? utxosRes.value
    : [];

  const xlm = treasury?.balances.find((b) => b.asset_type === "native");
  const opexBalance = xlm ? `${parseFloat(xlm.balance).toFixed(2)} XLM` : "—";
  const name = pp.label || truncate(pp.publicKey);

  root.innerHTML = renderTemplate(pp, name, opexBalance, memberships);

  wireHeader(root, pp);
  wireFund(root, pp.publicKey);
  wireCouncils(root);

  const dashboard = setupDashboard(root, ppPublicKey, primaryChannelId, initialUtxos);

  // Live events
  const client = new EventsClient({
    ppPublicKey,
    onEvent: (event) => dashboard.handleEvent(event),
    onStatus: (status) => dashboard.setStatus(status),
  });
  client.start();
  onCleanup(() => client.stop());

  return root;
}

function renderTemplate(
  pp: PpInfo,
  name: string,
  opexBalance: string,
  memberships: MembershipInfo[],
): string {
  const councilCards = memberships.length === 0
    ? `<div style="color:var(--text-muted)">No council memberships yet.</div>`
    : memberships.map((m) => renderCouncilCard(m)).join("");

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
      <div style="display:flex;align-items:center;gap:0.5rem">
        <a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a>
        <h2 style="margin:0">${escapeHtml(name)}</h2>
      </div>
      <button id="copy-pp-address" class="icon-btn" title="Copy provider address"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
    </div>

    <div class="stat-card" style="padding:1rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:0.75rem;max-width:520px">
      <div style="display:flex;align-items:center;gap:0.4rem">
        <span class="stat-label">Balance</span>
        <button id="copy-opex-address" class="icon-btn" title="Copy OpEx address"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
      </div>
      <span class="stat-value">${escapeHtml(opexBalance)}</span>
      <button id="fund-btn" class="btn-primary" style="margin-left:auto">Fund</button>
      <p id="fund-error" class="error-text" hidden style="margin:0"></p>
    </div>

    <h3 style="margin:0 0 0.5rem">Councils</h3>
    <div id="councils" style="display:grid;gap:0.75rem;margin-bottom:2rem">${councilCards}</div>

    <div style="display:flex;align-items:baseline;gap:0.75rem;margin-bottom:0.5rem">
      <h3 style="margin:0">Dashboard</h3>
      <span id="events-status" class="badge" data-status="connecting">connecting…</span>
    </div>

    <div id="dashboard" style="display:grid;grid-template-columns:repeat(6,1fr);gap:0.75rem;margin-bottom:1.5rem">
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Deposit</div>
        <div id="deposit-list" class="dashboard-column"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Mempool</div>
        <div id="mempool-list" class="dashboard-column"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Submitted</div>
        <div id="submitted-list" class="dashboard-column"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Verified</div>
        <div id="verified-list" class="dashboard-column"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">UTXOs</div>
        <div id="utxos-list" class="dashboard-column"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Withdrawn</div>
        <div id="withdrawn-list" class="dashboard-column"></div>
      </div>
    </div>

    <div id="tx-detail" class="stat-card" style="padding:1rem;display:none"></div>
  `;
}

function renderCouncilCard(m: MembershipInfo): string {
  const merged = mergedJurisdictions(m);
  const flagsHtml = merged.length ? flags(merged) : "—";
  const assetChips = m.channels.length
    ? m.channels.map((c) =>
      `<button class="badge badge-active asset-chip" data-channel="${
        escapeHtml(c.channelContractId)
      }" title="Click to copy channel id" style="border:none;cursor:pointer;margin-right:0.25rem">${
        escapeHtml(c.assetCode)
      }</button>`
    ).join("")
    : '<span style="color:var(--text-muted);font-size:0.85rem">No assets yet</span>';
  return `
    <div class="stat-card ${m.status === "ACTIVE" ? "active" : "pending"}" style="padding:0.75rem 1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
        <span style="font-weight:600">${escapeHtml(m.councilName || "—")}</span>
        <div>${flagsHtml}</div>
      </div>
      <div style="display:flex;gap:0.25rem;flex-wrap:wrap">${assetChips}</div>
    </div>
  `;
}

function wireHeader(root: HTMLElement, pp: PpInfo): void {
  for (const id of ["#copy-pp-address", "#copy-opex-address"]) {
    const btn = root.querySelector(id) as HTMLButtonElement | null;
    btn?.addEventListener("click", () => {
      navigator.clipboard.writeText(pp.publicKey).then(() =>
        withBriefCopyFeedback(btn)
      );
    });
  }
}

function wireFund(root: HTMLElement, ppPublicKey: string): void {
  const fundBtn = root.querySelector("#fund-btn") as HTMLButtonElement;
  const errEl = root.querySelector("#fund-error") as HTMLElement;
  fundBtn?.addEventListener("click", async () => {
    const amount = globalThis.prompt(
      "Amount in XLM to send from your wallet to the provider's OpEx address:",
      "10",
    );
    if (!amount) return;
    fundBtn.disabled = true;
    fundBtn.textContent = "Building…";
    errEl.hidden = true;
    try {
      const source = getConnectedAddress();
      if (!source) throw new Error("Wallet not connected");
      const xdr = await buildFundTx(source, ppPublicKey, amount.trim());
      fundBtn.textContent = "Sign in wallet…";
      const signed = await signTransaction(xdr);
      fundBtn.textContent = "Submitting…";
      await submitHorizonTx(signed);
      fundBtn.textContent = "Funded!";
      setTimeout(() => {
        fundBtn.textContent = "Fund";
        fundBtn.disabled = false;
      }, 1500);
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : String(err);
      errEl.hidden = false;
      fundBtn.textContent = "Fund";
      fundBtn.disabled = false;
    }
  });
}

function wireCouncils(root: HTMLElement): void {
  root.querySelectorAll(".asset-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const channelId = (btn as HTMLElement).dataset.channel;
      if (!channelId) return;
      navigator.clipboard.writeText(channelId).then(() => {
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => {
          btn.textContent = orig;
        }, 1200);
      });
    });
  });
}

type DashboardHandle = {
  handleEvent: (event: ProviderEvent) => void;
  setStatus: (status: "connecting" | "open" | "closed") => void;
};

type ClickContext =
  | { kind: "tx"; txId: string }
  | { kind: "utxo"; utxoId: string }
  | { kind: "withdraw"; txId: string; bundleId: string; recipientAddress: string };

function setupDashboard(
  root: HTMLElement,
  ppPublicKey: string,
  channelContractId: string | null,
  initialUtxos: UtxoInfo[],
): DashboardHandle {
  const statusEl = root.querySelector("#events-status") as HTMLElement;
  const depositEl = root.querySelector("#deposit-list") as HTMLElement;
  const mempoolEl = root.querySelector("#mempool-list") as HTMLElement;
  const submittedEl = root.querySelector("#submitted-list") as HTMLElement;
  const verifiedEl = root.querySelector("#verified-list") as HTMLElement;
  const utxosEl = root.querySelector("#utxos-list") as HTMLElement;
  const withdrawnEl = root.querySelector("#withdrawn-list") as HTMLElement;
  const txDetailEl = root.querySelector("#tx-detail") as HTMLElement;

  const utxos = new Map<string, UtxoInfo>(initialUtxos.map((u) => [u.id, u]));
  const mempool = new Map<string, HTMLElement>();
  const submitted = new Map<string, HTMLElement>();

  function fadeInItem(el: HTMLElement): void {
    requestAnimationFrame(() => el.classList.add("is-visible"));
  }

  function fadeOutAndRemove(el: HTMLElement | undefined): void {
    if (!el) return;
    el.classList.remove("is-visible");
    setTimeout(() => el.remove(), ITEM_FADE_OUT_MS);
  }

  function makeItem(label: string, subLabel?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "dashboard-item";
    el.innerHTML = `<span class="mono" style="overflow:hidden;text-overflow:ellipsis">${
      escapeHtml(label)
    }</span>${
      subLabel
        ? `<span style="color:var(--text-muted);font-size:0.7rem">${escapeHtml(subLabel)}</span>`
        : ""
    }`;
    return el;
  }

  function trimHistory(container: HTMLElement): void {
    while (container.childElementCount > KEEP_LAST_HISTORICAL) {
      container.firstElementChild?.remove();
    }
  }

  function renderUtxos(): void {
    utxosEl.textContent = "";
    if (utxos.size === 0) {
      utxosEl.innerHTML =
        '<span style="color:var(--text-muted);font-size:0.75rem">No active UTXOs</span>';
      return;
    }
    for (const u of utxos.values()) {
      const item = makeItem(truncate(u.id), `${fmtAmountStroops(u.amount)} XLM`);
      item.title = u.id;
      item.dataset.utxoId = u.id;
      item.addEventListener(
        "click",
        () => showDetail({ kind: "utxo", utxoId: u.id }),
      );
      utxosEl.appendChild(item);
      fadeInItem(item);
    }
  }
  renderUtxos();

  async function refreshUtxos(): Promise<void> {
    if (!channelContractId) return;
    try {
      const rows = await getUtxos(ppPublicKey, channelContractId);
      utxos.clear();
      for (const u of rows) utxos.set(u.id, u);
      renderUtxos();
    } catch { /* best effort */ }
  }

  async function showDetail(ctx: ClickContext): Promise<void> {
    txDetailEl.style.display = "block";
    txDetailEl.innerHTML =
      `<div style="color:var(--text-muted)">Loading…</div>`;
    if (ctx.kind === "utxo") {
      const u = utxos.get(ctx.utxoId);
      txDetailEl.innerHTML = renderUtxoDetail(u, ctx.utxoId);
      return;
    }
    try {
      const detail = await getTransactionDetail(ctx.txId, ppPublicKey);
      txDetailEl.innerHTML = ctx.kind === "withdraw"
        ? renderWithdrawDetail(detail, ctx.recipientAddress)
        : renderTxDetail(detail);
    } catch (err) {
      txDetailEl.innerHTML = `<p class="error-text">${
        escapeHtml(err instanceof Error ? err.message : String(err))
      }</p>`;
    }
  }

  return {
    handleEvent(event) {
      switch (event.kind) {
        case "mempool.bundle_added": {
          if (mempool.has(event.payload.bundleId)) return;
          const item = makeItem(truncate(event.payload.bundleId));
          item.title = event.payload.bundleId;
          mempool.set(event.payload.bundleId, item);
          mempoolEl.appendChild(item);
          fadeInItem(item);
          break;
        }
        case "mempool.bundle_expired": {
          fadeOutAndRemove(mempool.get(event.payload.bundleId));
          mempool.delete(event.payload.bundleId);
          break;
        }
        case "executor.transaction_submitted": {
          for (const bid of event.payload.bundleIds) {
            fadeOutAndRemove(mempool.get(bid));
            mempool.delete(bid);
          }
          if (submitted.has(event.payload.txHash)) return;
          const item = makeItem(truncate(event.payload.txHash));
          item.title = event.payload.txHash;
          item.addEventListener(
            "click",
            () => showDetail({ kind: "tx", txId: event.payload.txHash }),
          );
          submitted.set(event.payload.txHash, item);
          submittedEl.appendChild(item);
          fadeInItem(item);
          break;
        }
        case "executor.execution_failed": {
          for (const bid of event.payload.bundleIds) {
            fadeOutAndRemove(mempool.get(bid));
            mempool.delete(bid);
          }
          break;
        }
        case "verifier.bundle_completed": {
          fadeOutAndRemove(submitted.get(event.payload.txId));
          submitted.delete(event.payload.txId);
          const item = makeItem(truncate(event.payload.txId));
          item.title = event.payload.txId;
          item.addEventListener(
            "click",
            () => showDetail({ kind: "tx", txId: event.payload.txId }),
          );
          verifiedEl.appendChild(item);
          fadeInItem(item);
          trimHistory(verifiedEl);
          refreshUtxos();
          break;
        }
        case "verifier.bundle_failed": {
          fadeOutAndRemove(submitted.get(event.payload.txId));
          submitted.delete(event.payload.txId);
          break;
        }
        case "bundle.deposit_completed": {
          const item = makeItem(
            truncate(event.payload.depositorAddress, 8, 4),
            `${fmtAmountStroops(event.payload.amount)} XLM`,
          );
          item.title = event.payload.depositorAddress;
          const payload = event.payload;
          item.addEventListener(
            "click",
            () => showDetail({ kind: "tx", txId: payload.txId }),
          );
          depositEl.appendChild(item);
          fadeInItem(item);
          trimHistory(depositEl);
          refreshUtxos();
          break;
        }
        case "bundle.withdraw_completed": {
          const item = makeItem(
            truncate(event.payload.recipientAddress, 8, 4),
            `${fmtAmountStroops(event.payload.amount)} XLM`,
          );
          item.title = event.payload.recipientAddress;
          const payload = event.payload;
          item.addEventListener(
            "click",
            () =>
              showDetail({
                kind: "withdraw",
                txId: payload.txId,
                bundleId: payload.bundleId,
                recipientAddress: payload.recipientAddress,
              }),
          );
          withdrawnEl.appendChild(item);
          fadeInItem(item);
          trimHistory(withdrawnEl);
          refreshUtxos();
          break;
        }
      }
    },
    setStatus(status) {
      statusEl.dataset.status = status;
      statusEl.textContent = status === "open"
        ? "connected"
        : status === "connecting"
        ? "connecting…"
        : "disconnected";
    },
  };
}

function renderTxDetail(d: TransactionDetail): string {
  const sendersHtml = d.senders.length
    ? d.senders.map((s) =>
      `<span class="mono" title="${escapeHtml(s)}">${escapeHtml(truncate(s, 8, 6))}</span>`
    ).join(", ")
    : '<span style="color:var(--text-muted)">unknown</span>';
  const receiversHtml = d.receivers.length
    ? d.receivers.map((r) =>
      `<span class="mono" title="${escapeHtml(r)}">${escapeHtml(truncate(r, 8, 6))}</span>`
    ).join(", ")
    : '<span style="color:var(--text-muted)">unknown</span>';
  const fromFlags = d.jurisdictions.from.length
    ? flags(d.jurisdictions.from)
    : '<span style="color:var(--text-muted)">—</span>';
  const toFlags = d.jurisdictions.to.length
    ? flags(d.jurisdictions.to)
    : '<span style="color:var(--text-muted)">—</span>';
  const utxosHtml = d.utxos.length
    ? d.utxos.map((u) =>
      `<li><span class="mono" title="${escapeHtml(u.id)}">${escapeHtml(truncate(u.id))}</span> — ${fmtAmountStroops(u.amount)} XLM${
        u.spent ? " (spent)" : ""
      }</li>`
    ).join("")
    : '<li style="color:var(--text-muted)">No UTXOs in this tx</li>';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
      <div style="font-weight:600">Transaction</div>
      <span class="badge badge-${d.status === "VERIFIED" ? "active" : "pending"}">${
    escapeHtml(d.status)
  }</span>
    </div>
    <p class="mono" style="font-size:0.75rem;color:var(--text-muted);word-break:break-all;margin:0 0 0.75rem">${
    escapeHtml(d.id)
  }</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;font-size:0.85rem">
      <div>
        <span class="stat-label">Mempool</span>
        <div>${fmtTime(d.timeline.mempoolAt)}</div>
      </div>
      <div>
        <span class="stat-label">Submitted</span>
        <div>${fmtTime(d.timeline.submittedAt)}</div>
      </div>
      <div>
        <span class="stat-label">Verified</span>
        <div>${fmtTime(d.timeline.verifiedAt)}</div>
      </div>
      <div>
        <span class="stat-label">From</span>
        <div style="margin-top:0.25rem">${fromFlags}</div>
      </div>
      <div>
        <span class="stat-label">To</span>
        <div style="margin-top:0.25rem">${toFlags}</div>
      </div>
      <div>
        <span class="stat-label">Ledger</span>
        <div>${escapeHtml(d.ledgerSequence)}</div>
      </div>
      <div>
        <span class="stat-label">Sender(s)</span>
        <div>${sendersHtml}</div>
      </div>
      <div style="grid-column:span 2">
        <span class="stat-label">Receiver(s)</span>
        <div>${receiversHtml}</div>
      </div>
    </div>
    <div style="margin-top:0.75rem">
      <span class="stat-label">UTXOs (${d.utxos.length})</span>
      <ul style="font-size:0.8rem;margin:0.4rem 0 0;padding-left:1.2rem">${utxosHtml}</ul>
    </div>
  `;
}

function renderUtxoDetail(u: UtxoInfo | undefined, utxoId: string): string {
  if (!u) {
    return `
      <div style="font-weight:600;margin-bottom:0.5rem">UTXO</div>
      <p class="mono" style="font-size:0.75rem;color:var(--text-muted);word-break:break-all">${
      escapeHtml(utxoId)
    }</p>
      <p style="color:var(--text-muted)">No active record (it may have just been spent or withdrawn).</p>
    `;
  }
  return `
    <div style="font-weight:600;margin-bottom:0.5rem">UTXO</div>
    <p class="mono" style="font-size:0.75rem;color:var(--text-muted);word-break:break-all;margin:0 0 0.75rem">${
    escapeHtml(u.id)
  }</p>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;font-size:0.85rem">
      <div>
        <span class="stat-label">Amount</span>
        <div>${fmtAmountStroops(u.amount)} XLM</div>
      </div>
      <div>
        <span class="stat-label">Created at bundle</span>
        <div class="mono" style="font-size:0.75rem">${escapeHtml(truncate(u.createdAtBundleId))}</div>
      </div>
      <div>
        <span class="stat-label">Created</span>
        <div>${escapeHtml(new Date(u.createdAt).toLocaleString())}</div>
      </div>
    </div>
  `;
}

function renderWithdrawDetail(d: TransactionDetail, recipient: string): string {
  const totalStroops = d.withdraws.reduce(
    (acc, w) => acc + BigInt(w.amount),
    0n,
  );
  const utxos = d.utxos.filter((u) => u.spent);
  const utxosHtml = utxos.length
    ? utxos.map((u) =>
      `<li><span class="mono" title="${escapeHtml(u.id)}">${escapeHtml(truncate(u.id))}</span> — ${fmtAmountStroops(u.amount)} XLM</li>`
    ).join("")
    : `<li style="color:var(--text-muted)">No UTXOs in tx record</li>`;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
      <div style="font-weight:600">Withdraw</div>
      <span class="badge badge-${d.status === "VERIFIED" ? "active" : "pending"}">${
    escapeHtml(d.status)
  }</span>
    </div>
    <p style="font-size:0.85rem;margin:0 0 0.75rem">
      <span style="color:var(--text-muted)">Tx</span> <span class="mono">${
    escapeHtml(truncate(d.id))
  }</span>
    </p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;font-size:0.85rem">
      <div>
        <span class="stat-label">Recipient</span>
        <div class="mono" style="font-size:0.75rem;word-break:break-all" title="${
    escapeHtml(recipient)
  }">${escapeHtml(truncate(recipient, 8, 6))}</div>
      </div>
      <div>
        <span class="stat-label">Total withdrawn</span>
        <div>${fmtAmountStroops(totalStroops.toString())} XLM</div>
      </div>
      <div>
        <span class="stat-label">UTXOs spent</span>
        <div>${utxos.length}</div>
      </div>
      <div>
        <span class="stat-label">Submitted</span>
        <div>${fmtTime(d.timeline.submittedAt)}</div>
      </div>
      <div>
        <span class="stat-label">Verified</span>
        <div>${fmtTime(d.timeline.verifiedAt)}</div>
      </div>
      <div>
        <span class="stat-label">Ledger</span>
        <div>${escapeHtml(d.ledgerSequence)}</div>
      </div>
    </div>
    <div style="margin-top:0.75rem">
      <span class="stat-label">Withdrawn UTXOs</span>
      <ul style="font-size:0.8rem;margin:0.4rem 0 0;padding-left:1.2rem">${utxosHtml}</ul>
    </div>
  `;
}

export const providerView = page(renderContent);
