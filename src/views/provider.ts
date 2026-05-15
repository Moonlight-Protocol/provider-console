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

const VERIFIED_DRIFT_MS = 3000;
const ADDRESS_TRUNC = 12;

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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem">
      <div style="display:flex;align-items:center;gap:0.5rem">
        <a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a>
        <h2 style="margin:0">${escapeHtml(name)}</h2>
      </div>
      <button id="copy-pp-address" class="icon-btn" title="Copy provider address"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
    </div>
    <p class="mono" style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1.5rem;word-break:break-all">${
    escapeHtml(pp.publicKey)
  }</p>

    <div class="stat-card" style="padding:1rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:1rem;max-width:520px">
      <div>
        <span class="stat-label">OpEx balance</span>
        <span class="stat-value" style="display:block;margin-top:0.25rem">${
    escapeHtml(opexBalance)
  }</span>
      </div>
      <button id="fund-btn" class="btn-primary" style="margin-left:auto">Fund</button>
      <p id="fund-error" class="error-text" hidden style="margin:0"></p>
    </div>

    <h3 style="margin:0 0 0.5rem">Councils</h3>
    <div id="councils" style="display:grid;gap:0.75rem;margin-bottom:2rem">${councilCards}</div>

    <div style="display:flex;align-items:baseline;gap:0.75rem;margin-bottom:0.5rem">
      <h3 style="margin:0">Dashboard</h3>
      <span id="events-status" class="badge" data-status="connecting">connecting…</span>
    </div>

    <div id="dashboard" style="display:grid;grid-template-columns:1fr 2fr 1fr 1fr;gap:0.75rem;margin-bottom:1.5rem">
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">UTXOs</div>
        <div id="utxos-list" style="display:flex;flex-direction:column;gap:0.25rem;max-height:18rem;overflow-y:auto"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem;position:relative;overflow:hidden;min-height:8rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Verified</div>
        <div id="verified-lane" style="position:relative;height:6rem"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Submitted</div>
        <div id="submitted-list" style="display:flex;flex-direction:column;gap:0.25rem"></div>
      </div>
      <div class="stat-card" style="padding:0.75rem">
        <div style="font-weight:600;margin-bottom:0.5rem">Mempool</div>
        <div id="mempool-list" style="display:flex;flex-direction:column;gap:0.25rem"></div>
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
  const copyBtn = root.querySelector("#copy-pp-address") as HTMLButtonElement;
  copyBtn?.addEventListener("click", () => {
    navigator.clipboard.writeText(pp.publicKey).then(() =>
      withBriefCopyFeedback(copyBtn)
    );
  });
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

function setupDashboard(
  root: HTMLElement,
  ppPublicKey: string,
  channelContractId: string | null,
  initialUtxos: UtxoInfo[],
): DashboardHandle {
  const statusEl = root.querySelector("#events-status") as HTMLElement;
  const utxosEl = root.querySelector("#utxos-list") as HTMLElement;
  const verifiedEl = root.querySelector("#verified-lane") as HTMLElement;
  const submittedEl = root.querySelector("#submitted-list") as HTMLElement;
  const mempoolEl = root.querySelector("#mempool-list") as HTMLElement;
  const txDetailEl = root.querySelector("#tx-detail") as HTMLElement;

  // Local state
  const utxos = new Map<string, UtxoInfo>(initialUtxos.map((u) => [u.id, u]));
  const mempool = new Map<string, HTMLElement>();
  const submitted = new Map<string, HTMLElement>();

  function renderUtxos(): void {
    utxosEl.textContent = "";
    if (utxos.size === 0) {
      utxosEl.innerHTML =
        '<span style="color:var(--text-muted);font-size:0.85rem">No active UTXOs</span>';
      return;
    }
    for (const u of utxos.values()) {
      const row = document.createElement("div");
      row.dataset.utxoId = u.id;
      row.style.cssText =
        "padding:0.25rem 0.5rem;border:1px solid var(--border);border-radius:4px;font-size:0.8rem;display:flex;justify-content:space-between";
      row.innerHTML = `
        <span class="mono" title="${escapeHtml(u.id)}">${escapeHtml(truncate(u.id))}</span>
        <span>${fmtAmountStroops(u.amount)} XLM</span>
      `;
      utxosEl.appendChild(row);
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

  function makeListItem(text: string, jurisdictionFlag?: string): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText =
      "padding:0.4rem 0.6rem;border:1px solid var(--border);border-radius:4px;font-size:0.8rem;opacity:0;transition:opacity 200ms;display:flex;justify-content:space-between;align-items:center;cursor:pointer";
    el.innerHTML = `<span class="mono">${escapeHtml(text)}</span>${
      jurisdictionFlag ? `<span style="font-size:1rem">${jurisdictionFlag}</span>` : ""
    }`;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
    });
    return el;
  }

  function fadeAndRemove(el: HTMLElement | undefined): void {
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 200);
  }

  function pushVerifiedTx(txId: string, toJurisdiction?: string): void {
    const el = document.createElement("div");
    el.dataset.txId = txId;
    const top = Math.floor(Math.random() * 70);
    el.style.cssText =
      `position:absolute;top:${top}%;right:0;padding:0.3rem 0.55rem;border:1px solid var(--border);border-radius:4px;font-size:0.75rem;background:var(--surface);cursor:pointer;animation:tx-drift ${VERIFIED_DRIFT_MS}ms linear forwards;display:flex;gap:0.4rem;align-items:center`;
    el.innerHTML = `<span class="mono">${escapeHtml(truncate(txId))}</span>${
      toJurisdiction ? `<span>${toJurisdiction}</span>` : ""
    }`;
    el.addEventListener("click", () => showTxDetail(txId));
    el.addEventListener("animationend", () => el.remove());
    verifiedEl.appendChild(el);
  }

  async function showTxDetail(txId: string): Promise<void> {
    txDetailEl.style.display = "block";
    txDetailEl.innerHTML =
      `<div style="color:var(--text-muted)">Loading tx ${escapeHtml(truncate(txId))}…</div>`;
    let detail: TransactionDetail;
    try {
      detail = await getTransactionDetail(txId, ppPublicKey);
    } catch (err) {
      txDetailEl.innerHTML = `<p class="error-text">${
        escapeHtml(err instanceof Error ? err.message : String(err))
      }</p>`;
      return;
    }
    txDetailEl.innerHTML = renderTxDetail(detail);
  }

  return {
    handleEvent(event) {
      switch (event.kind) {
        case "mempool.bundle_added": {
          if (mempool.has(event.payload.bundleId)) return;
          const item = makeListItem(truncate(event.payload.bundleId));
          item.title = event.payload.bundleId;
          mempool.set(event.payload.bundleId, item);
          mempoolEl.appendChild(item);
          break;
        }
        case "mempool.bundle_expired": {
          fadeAndRemove(mempool.get(event.payload.bundleId));
          mempool.delete(event.payload.bundleId);
          break;
        }
        case "executor.transaction_submitted": {
          // Move bundles from mempool to submitted, keyed by txHash
          for (const bid of event.payload.bundleIds) {
            fadeAndRemove(mempool.get(bid));
            mempool.delete(bid);
          }
          if (submitted.has(event.payload.txHash)) return;
          const item = makeListItem(truncate(event.payload.txHash));
          item.title = event.payload.txHash;
          item.addEventListener("click", () => showTxDetail(event.payload.txHash));
          submitted.set(event.payload.txHash, item);
          submittedEl.appendChild(item);
          break;
        }
        case "executor.execution_failed": {
          for (const bid of event.payload.bundleIds) {
            fadeAndRemove(mempool.get(bid));
            mempool.delete(bid);
          }
          break;
        }
        case "verifier.bundle_completed": {
          fadeAndRemove(submitted.get(event.payload.txId));
          submitted.delete(event.payload.txId);
          pushVerifiedTx(event.payload.txId);
          refreshUtxos();
          break;
        }
        case "verifier.bundle_failed": {
          fadeAndRemove(submitted.get(event.payload.txId));
          submitted.delete(event.payload.txId);
          break;
        }
        case "bundle.deposit_completed": {
          // New UTXOs may have been created — refresh list.
          refreshUtxos();
          break;
        }
        case "bundle.withdraw_completed": {
          // UTXO(s) just left the channel — refresh + briefly flash the row
          // we don't know the exact id, but a refresh removes spent ones.
          flashLastUtxoWithRecipient(event.payload.recipientAddress);
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

  function flashLastUtxoWithRecipient(recipient: string): void {
    // The on-screen UTXO list is about to refresh; before that, briefly show
    // the recipient address on the rows that will go away. We don't know
    // which exact UTXO without a follow-up fetch, so we mark all rows.
    utxosEl.querySelectorAll("[data-utxo-id]").forEach((el) => {
      const note = document.createElement("div");
      note.style.cssText =
        "font-size:0.7rem;color:var(--text-muted);margin-top:0.15rem";
      note.innerHTML = `→ ${escapeHtml(truncate(recipient, ADDRESS_TRUNC, 4))}`;
      (el as HTMLElement).appendChild(note);
    });
  }
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

export const providerView = page(renderContent);
