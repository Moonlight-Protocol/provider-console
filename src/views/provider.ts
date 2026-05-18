import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import {
  discoverCouncil,
  getTransactionDetail,
  getTreasury,
  listPps,
  listTransactions,
  type MembershipInfo,
  type PpInfo,
  type TransactionDetail,
  type TreasuryData,
  type UtxoInfo,
} from "../lib/api.ts";
import { getRouteParams, navigate, onCleanup } from "../lib/router.ts";
import { EventsClient, type ProviderEvent } from "../lib/events-client.ts";
import { getConnectedAddress, signTransaction } from "../lib/wallet.ts";
import { buildFundTx, submitHorizonTx } from "../lib/stellar.ts";
import { API_BASE_URL } from "../lib/config.ts";

const ITEM_FADE_OUT_MS = 300;
const KEEP_LAST_HISTORICAL = 30;
const LIVE_ITEM_LIFETIME_MS = 30_000;

function truncate(s: string, head = 6, tail = 4): string {
  return s.length > head + tail + 1
    ? `${s.slice(0, head)}…${s.slice(-tail)}`
    : s;
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

  let treasury: TreasuryData | null = null;
  try {
    treasury = await getTreasury(ppPublicKey);
  } catch { /* best effort */ }

  const xlm = treasury?.balances.find((b) => b.asset_type === "native");
  const opexBalance = xlm ? `${parseFloat(xlm.balance).toFixed(2)} XLM` : "—";
  const name = pp.label || truncate(pp.publicKey);

  // Sibling-PP lists per council: one POST /dashboard/council/discover per
  // membership, in parallel, cached in-memory for the view's lifetime. Best-
  // effort — failures render the council node with no sibling dots rather than
  // blocking the whole view.
  const siblingsByCouncil = new Map<
    string,
    Array<{ publicKey: string; label: string | null }>
  >();
  const discoveryResults = await Promise.allSettled(
    memberships.map(async (m) => {
      const info = await discoverCouncil(m.councilUrl);
      return { councilUrl: m.councilUrl, providers: info.providers };
    }),
  );
  for (const r of discoveryResults) {
    if (r.status === "fulfilled") {
      siblingsByCouncil.set(r.value.councilUrl, r.value.providers);
    }
  }

  root.innerHTML = renderTemplate(
    pp,
    name,
    opexBalance,
    memberships,
    siblingsByCouncil,
  );

  wireMyPpActions(root, pp);
  wireFund(root, pp.publicKey);

  const dashboard = setupDashboard(root, ppPublicKey, primaryChannelId);

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

// Topology layout — fixed-size SVG canvas with absolutely-positioned HTML
// nodes for the MY-PP center + each council. Edges live in the SVG layer
// underneath. Sized to roughly match the sketch (~850×470).
const TOPOLOGY_WIDTH = 850;
const TOPOLOGY_HEIGHT = 470;
const TOPOLOGY_CENTER_X = TOPOLOGY_WIDTH / 2;
const TOPOLOGY_CENTER_Y = TOPOLOGY_HEIGHT / 2;
const COUNCIL_RING_RADIUS = 180;
const SIBLING_DOTS_VISIBLE = 10;

function councilNodePosition(
  index: number,
  total: number,
): { x: number; y: number } {
  // Start at the top (theta = -π/2) and walk clockwise so the visual matches
  // a clock face.
  const theta = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(total, 1);
  return {
    x: TOPOLOGY_CENTER_X + COUNCIL_RING_RADIUS * Math.cos(theta),
    y: TOPOLOGY_CENTER_Y + COUNCIL_RING_RADIUS * Math.sin(theta),
  };
}

function renderTopology(
  name: string,
  opexBalance: string,
  memberships: MembershipInfo[],
  siblingsByCouncil: Map<
    string,
    Array<{ publicKey: string; label: string | null }>
  >,
): string {
  const positions = memberships.map((_, i) =>
    councilNodePosition(i, memberships.length)
  );

  const edges = positions
    .map(
      (p) =>
        `<line x1="${TOPOLOGY_CENTER_X}" y1="${TOPOLOGY_CENTER_Y}" x2="${p.x}" y2="${p.y}" stroke="var(--border)" stroke-width="2" />`,
    )
    .join("");

  const councilNodes = memberships
    .map((m, i) => renderCouncilNode(m, positions[i], siblingsByCouncil))
    .join("");

  const emptyState = memberships.length === 0
    ? `<div class="topology-empty" style="position:absolute;left:50%;top:80%;transform:translate(-50%,-50%);color:var(--text-muted);font-size:0.85rem;text-align:center">No council memberships yet — join a council to see it here.</div>`
    : "";

  return `
    <div id="topology" class="topology" style="position:relative;width:${TOPOLOGY_WIDTH}px;height:${TOPOLOGY_HEIGHT}px;margin:0 auto">
      <svg viewBox="0 0 ${TOPOLOGY_WIDTH} ${TOPOLOGY_HEIGHT}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">${edges}</svg>
      ${renderMyPpNode(name, opexBalance)}
      ${councilNodes}
      ${emptyState}
    </div>
  `;
}

function renderMyPpNode(name: string, opexBalance: string): string {
  // Yellow ellipse per sketch §Zone 2. Absorbs OpEx Balance + Fund / Copy-PK
  // / Copy-URL action chips (the v1 header actions, plural per sketch).
  return `
    <div class="topology-my-pp" style="position:absolute;left:${TOPOLOGY_CENTER_X}px;top:${TOPOLOGY_CENTER_Y}px;transform:translate(-50%,-50%);width:200px;background:#fff3bf;color:#1a1a1a;border:3px solid #1a1a1a;border-radius:50%/35%;padding:0.9rem 1.1rem;display:flex;flex-direction:column;align-items:center;gap:0.4rem;text-align:center">
      <div style="font-weight:700;font-size:0.95rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${
    escapeHtml(name)
  }">${escapeHtml(name)}</div>
      <div style="font-size:0.7rem;letter-spacing:0.05em;text-transform:uppercase;color:#555">OpEx Balance</div>
      <div style="font-weight:600;font-size:1.05rem">${
    escapeHtml(opexBalance)
  }</div>
      <p id="fund-error" class="error-text" hidden style="margin:0;font-size:0.75rem;max-width:100%"></p>
      <div style="display:flex;gap:0.35rem;flex-wrap:wrap;justify-content:center;margin-top:0.15rem">
        <button id="fund-btn" class="topology-action-chip" type="button">Fund</button>
        <button id="copy-opex-address" class="topology-action-chip" type="button">Copy PK</button>
        <button id="copy-provider-url" class="topology-action-chip" type="button">Copy URL</button>
      </div>
    </div>
  `;
}

function renderCouncilNode(
  m: MembershipInfo,
  pos: { x: number; y: number },
  siblingsByCouncil: Map<
    string,
    Array<{ publicKey: string; label: string | null }>
  >,
): string {
  const merged = mergedJurisdictions(m);
  const flagsHtml = merged.length ? flags(merged) : "";
  const assetCount = m.channels.length;
  // PR-B renders every council node in the "idle" (gray) palette per the
  // sketch. The green/amber palette comes alive when pulses land — there's
  // no per-council activity feed in any current endpoint to colorize on.
  const fill = "#e9ecef";
  const stroke = "#868e96";

  const siblings = siblingsByCouncil.get(m.councilUrl) ?? [];
  const siblingDots = renderSiblingDots(siblings);
  const siblingCaption = siblings.length === 0
    ? "— no sibling PPs yet —"
    : `(${siblings.length} sibling PP${siblings.length === 1 ? "" : "s"})`;

  return `
    <div class="topology-council-node" style="position:absolute;left:${pos.x}px;top:${pos.y}px;transform:translate(-50%,-50%);width:170px;background:${fill};border:2px solid ${stroke};border-radius:14px;padding:0.5rem 0.6rem;display:flex;flex-direction:column;gap:0.3rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
        <span style="font-weight:600;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${
    escapeHtml(m.councilName ?? "—")
  }">${escapeHtml(m.councilName ?? "—")}</span>
        <span style="font-size:0.85rem">${flagsHtml}</span>
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.7rem;color:#555">
        <span class="topology-activity-tag" style="background:#fff;border:1px solid ${stroke};padding:0.05rem 0.35rem;border-radius:10px">idle</span>
        <span>${assetCount} asset${assetCount === 1 ? "" : "s"}</span>
      </div>
      <div class="topology-sibling-dots" style="display:flex;flex-wrap:wrap;gap:3px;min-height:14px">${siblingDots}</div>
      <div style="font-size:0.65rem;color:#555;text-align:center">${siblingCaption}</div>
    </div>
  `;
}

function renderSiblingDots(
  siblings: Array<{ publicKey: string; label: string | null }>,
): string {
  if (siblings.length === 0) return "";
  const visible = siblings.slice(0, SIBLING_DOTS_VISIBLE);
  const overflow = siblings.length - visible.length;
  const dots = visible
    .map(
      (s) =>
        `<span class="topology-sibling-dot" title="${
          escapeHtml(s.label ?? s.publicKey)
        }" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#868e96"></span>`,
    )
    .join("");
  const more = overflow > 0
    ? `<span class="topology-sibling-overflow" style="font-size:0.65rem;color:#555;align-self:center">+${overflow}</span>`
    : "";
  return dots + more;
}

function renderTemplate(
  _pp: PpInfo,
  name: string,
  opexBalance: string,
  memberships: MembershipInfo[],
  siblingsByCouncil: Map<
    string,
    Array<{ publicKey: string; label: string | null }>
  >,
): string {
  return `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
      <a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a>
      <h2 style="margin:0">${escapeHtml(name)}</h2>
    </div>

    <div class="dashboard-v2" style="display:grid;grid-template-columns:1fr 280px;grid-template-areas:'counter counter' 'topology feed' 'sparklines sparklines';gap:0.75rem;margin-bottom:1.5rem">
      <div class="zone-counter" style="grid-area:counter;display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem">
        ${renderCounterPlaceholder("Throughput", "last 15m")}
        ${renderCounterPlaceholder("Avg Latency", "last 100")}
        ${renderCounterPlaceholder("Queue Depth", "now")}
        ${renderCounterPlaceholder("Error Rate", "1h")}
      </div>

      <div class="zone-topology stat-card" style="grid-area:topology;padding:0.75rem;overflow:auto">
        ${renderTopology(name, opexBalance, memberships, siblingsByCouncil)}
      </div>

      <div class="zone-feed stat-card" style="grid-area:feed;padding:0.75rem;min-height:${TOPOLOGY_HEIGHT}px;display:flex;flex-direction:column">
        <div style="font-weight:600;margin-bottom:0.5rem">Activity</div>
        <div class="zone-feed-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;text-align:center">
          No events yet —<br>live feed lights up<br>when pulses ship.
        </div>
      </div>

      <div class="zone-sparklines" style="grid-area:sparklines;display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;min-height:180px">
        ${renderSparklinePlaceholder("Throughput (bundles/min)")}
        ${renderSparklinePlaceholder("Latency mempool→verified (s)")}
        ${renderSparklinePlaceholder("Queue depth")}
      </div>
    </div>

    <div class="drill-down-section">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap">
        <h3 style="margin:0;margin-right:0.5rem">Drill-down</h3>
        <div role="tablist" style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <button id="mode-live" class="mode-tab" data-active="true" disabled>Live</button>
          <button id="mode-range" class="mode-tab" data-active="false">Range</button>
        </div>
        <label id="range-from-wrap" style="display:none;align-items:center;gap:0.25rem;font-size:0.8rem">From <input id="range-from" type="date" style="font-size:0.8rem"></label>
        <label id="range-to-wrap" style="display:none;align-items:center;gap:0.25rem;font-size:0.8rem">To <input id="range-to" type="date" style="font-size:0.8rem"></label>
        <button id="range-search" class="btn-primary" style="display:none;padding:0.25rem 0.7rem;font-size:0.8rem">Search</button>
        <span id="range-status" style="font-size:0.75rem;color:var(--text-muted)"></span>
      </div>

      <div id="dashboard" style="display:grid;grid-template-columns:repeat(5,1fr);gap:0.75rem;margin-bottom:1.5rem">
        <div class="stat-card" style="padding:0.75rem">
          <div style="font-weight:600;margin-bottom:0.5rem;display:flex;justify-content:space-between"><span>Deposit</span><span id="deposit-count" class="badge" style="font-weight:normal">0</span></div>
          <div id="deposit-list" class="dashboard-column"></div>
        </div>
        <div class="stat-card" style="padding:0.75rem">
          <div style="font-weight:600;margin-bottom:0.5rem;display:flex;justify-content:space-between"><span>Mempool</span><span id="mempool-count" class="badge" style="font-weight:normal">0</span></div>
          <div id="mempool-list" class="dashboard-column"></div>
        </div>
        <div class="stat-card" style="padding:0.75rem">
          <div style="font-weight:600;margin-bottom:0.5rem;display:flex;justify-content:space-between"><span>Submitted</span><span id="submitted-count" class="badge" style="font-weight:normal">0</span></div>
          <div id="submitted-list" class="dashboard-column"></div>
        </div>
        <div class="stat-card" style="padding:0.75rem">
          <div style="font-weight:600;margin-bottom:0.5rem;display:flex;justify-content:space-between"><span>Verified</span><span id="verified-count" class="badge" style="font-weight:normal">0</span></div>
          <div id="verified-list" class="dashboard-column"></div>
        </div>
        <div class="stat-card" style="padding:0.75rem">
          <div style="font-weight:600;margin-bottom:0.5rem;display:flex;justify-content:space-between"><span>Withdrawn</span><span id="withdrawn-count" class="badge" style="font-weight:normal">0</span></div>
          <div id="withdrawn-list" class="dashboard-column"></div>
        </div>
      </div>

      <div id="tx-detail" class="stat-card" style="padding:1rem;display:none;position:relative">
        <button id="tx-detail-close" class="icon-btn" title="Close" style="position:absolute;top:0.5rem;right:0.5rem"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div id="tx-detail-body"></div>
      </div>
    </div>
  `;
}

function renderCounterPlaceholder(label: string, window: string): string {
  return `
    <div class="zone-counter-box stat-card" style="padding:0.6rem 0.8rem;border-color:#1c7ed6;background:#e7f5ff">
      <div style="font-size:0.65rem;letter-spacing:0.06em;text-transform:uppercase;color:#1864ab;font-weight:600">${
    escapeHtml(label)
  }</div>
      <div style="font-size:0.65rem;color:#555">${escapeHtml(window)}</div>
      <div style="font-size:1.4rem;font-weight:700;color:#1864ab;margin-top:0.2rem">—</div>
    </div>
  `;
}

function renderSparklinePlaceholder(label: string): string {
  return `
    <div class="zone-sparkline-box stat-card" style="padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.3rem">
      <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">${
    escapeHtml(label)
  }</div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem">—</div>
    </div>
  `;
}

function wireMyPpActions(root: HTMLElement, pp: PpInfo): void {
  const opexBtn = root.querySelector(
    "#copy-opex-address",
  ) as HTMLButtonElement | null;
  opexBtn?.addEventListener("click", () => {
    navigator.clipboard.writeText(pp.publicKey).then(() =>
      withBriefCopyFeedback(opexBtn)
    );
  });
  const urlBtn = root.querySelector(
    "#copy-provider-url",
  ) as HTMLButtonElement | null;
  urlBtn?.addEventListener("click", () => {
    const providerUrl = new URL(API_BASE_URL).origin;
    navigator.clipboard.writeText(providerUrl).then(() =>
      withBriefCopyFeedback(urlBtn)
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
    errEl.hidden = true;
    console.debug("[fund] click — destination", ppPublicKey, "amount", amount);
    try {
      const source = getConnectedAddress();
      console.debug("[fund] source wallet address", source);
      if (!source) throw new Error("Wallet not connected");
      console.debug("[fund] building tx …");
      const xdr = await buildFundTx(source, ppPublicKey, amount.trim());
      console.debug("[fund] built tx xdr (first 80 chars)", xdr.slice(0, 80));
      const signed = await signTransaction(xdr);
      console.debug("[fund] signed xdr (first 80 chars)", signed.slice(0, 80));
      await submitHorizonTx(signed);
      console.debug("[fund] submitted OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[fund] failed", err);
      errEl.textContent = msg;
      errEl.hidden = false;
    } finally {
      fundBtn.disabled = false;
    }
  });
}

type DashboardMode = "live" | "range";

type DashboardHandle = {
  handleEvent: (event: ProviderEvent) => void;
  setStatus: (status: "connecting" | "open" | "closed") => void;
  setMode: (mode: DashboardMode) => void;
  loadRange: (txs: TransactionDetail[]) => void;
  getMode: () => DashboardMode;
};

type ClickContext =
  | { kind: "tx"; txId: string }
  | { kind: "utxo"; utxoId: string }
  | {
    kind: "withdraw";
    txId: string;
    bundleId: string;
    recipientAddress: string;
  };

function setupDashboard(
  root: HTMLElement,
  ppPublicKey: string,
  channelContractId: string | null,
): DashboardHandle {
  const liveBtn = root.querySelector("#mode-live") as HTMLButtonElement;
  const rangeBtn = root.querySelector("#mode-range") as HTMLButtonElement;
  const fromInput = root.querySelector("#range-from") as HTMLInputElement;
  const toInput = root.querySelector("#range-to") as HTMLInputElement;
  const fromWrap = root.querySelector("#range-from-wrap") as HTMLElement;
  const toWrap = root.querySelector("#range-to-wrap") as HTMLElement;
  const searchBtn = root.querySelector("#range-search") as HTMLButtonElement;
  const rangeStatusEl = root.querySelector("#range-status") as HTMLElement;
  const depositEl = root.querySelector("#deposit-list") as HTMLElement;
  const mempoolEl = root.querySelector("#mempool-list") as HTMLElement;
  const submittedEl = root.querySelector("#submitted-list") as HTMLElement;
  const verifiedEl = root.querySelector("#verified-list") as HTMLElement;
  const withdrawnEl = root.querySelector("#withdrawn-list") as HTMLElement;
  const txDetailEl = root.querySelector("#tx-detail") as HTMLElement;
  const txDetailBody = root.querySelector("#tx-detail-body") as HTMLElement;
  const txDetailClose = root.querySelector(
    "#tx-detail-close",
  ) as HTMLButtonElement;

  function hideTxDetail(): void {
    txDetailEl.style.display = "none";
    txDetailBody.innerHTML = "";
  }
  txDetailClose.addEventListener("click", hideTxDetail);

  const counts: Record<string, HTMLElement> = {
    deposit: root.querySelector("#deposit-count") as HTMLElement,
    mempool: root.querySelector("#mempool-count") as HTMLElement,
    submitted: root.querySelector("#submitted-count") as HTMLElement,
    verified: root.querySelector("#verified-count") as HTMLElement,
    withdrawn: root.querySelector("#withdrawn-count") as HTMLElement,
  };
  function syncCount(key: keyof typeof counts, container: HTMLElement): void {
    counts[key].textContent = String(container.childElementCount);
  }
  function syncAllCounts(): void {
    syncCount("deposit", depositEl);
    syncCount("mempool", mempoolEl);
    syncCount("submitted", submittedEl);
    syncCount("verified", verifiedEl);
    syncCount("withdrawn", withdrawnEl);
  }

  let mode: DashboardMode = "live";
  let wsStatus: "connecting" | "open" | "closed" = "connecting";

  function fadeInItem(el: HTMLElement): void {
    // Double rAF: forces the browser to paint the initial opacity:0 state
    // before adding is-visible, so the transition actually runs.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add("is-visible"));
    });
    if (mode === "live") {
      setTimeout(() => {
        console.debug(
          "[dashboard] item lifetime expired, fading",
          el.title || el.textContent,
        );
        fadeOutAndRemove(el);
      }, LIVE_ITEM_LIFETIME_MS);
    }
  }

  function clearAllColumns(): void {
    for (
      const el of [depositEl, mempoolEl, submittedEl, verifiedEl, withdrawnEl]
    ) el.textContent = "";
    hideTxDetail();
    syncAllCounts();
  }

  function updateModeUi(): void {
    liveBtn.dataset.active = mode === "live" ? "true" : "false";
    rangeBtn.dataset.active = mode === "range" ? "true" : "false";
    const showRangeControls = mode === "range";
    fromWrap.style.display = showRangeControls ? "inline-flex" : "none";
    toWrap.style.display = showRangeControls ? "inline-flex" : "none";
    searchBtn.style.display = showRangeControls ? "inline-block" : "none";
    liveBtn.disabled = wsStatus !== "open";
    rangeStatusEl.textContent = "";
  }

  function fadeOutAndRemove(el: HTMLElement | undefined): void {
    if (!el) return;
    el.classList.remove("is-visible");
    setTimeout(() => {
      el.remove();
      syncAllCounts();
    }, ITEM_FADE_OUT_MS);
  }

  function makeItem(label: string, subLabel?: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "dashboard-item";
    el.innerHTML =
      `<span class="mono" style="overflow:hidden;text-overflow:ellipsis">${
        escapeHtml(label)
      }</span>${
        subLabel
          ? `<span style="color:var(--text-muted);font-size:0.7rem">${
            escapeHtml(subLabel)
          }</span>`
          : ""
      }`;
    return el;
  }

  function trimHistory(container: HTMLElement): void {
    while (container.childElementCount > KEEP_LAST_HISTORICAL) {
      container.firstElementChild?.remove();
    }
  }

  syncAllCounts();

  async function showDetail(ctx: ClickContext): Promise<void> {
    txDetailEl.style.display = "block";
    txDetailBody.innerHTML =
      `<div style="color:var(--text-muted)">Loading…</div>`;
    if (ctx.kind === "utxo") {
      txDetailBody.innerHTML = renderUtxoDetail(undefined, ctx.utxoId);
      return;
    }
    try {
      const detail = await getTransactionDetail(ctx.txId, ppPublicKey);
      txDetailBody.innerHTML = ctx.kind === "withdraw"
        ? renderWithdrawDetail(detail, ctx.recipientAddress)
        : renderTxDetail(detail);
    } catch (err) {
      txDetailBody.innerHTML = `<p class="error-text">${
        escapeHtml(err instanceof Error ? err.message : String(err))
      }</p>`;
    }
  }

  function classifyTxIntoColumns(tx: TransactionDetail): void {
    const verified = tx.status === "VERIFIED";
    const isDeposit = tx.deposits.length > 0;
    const isWithdraw = tx.withdraws.length > 0;

    if (!verified) {
      // Tx never finalized — surface it under Submitted (its latest state).
      const item = makeItem(truncate(tx.id));
      item.title = tx.id;
      item.addEventListener(
        "click",
        () => showDetail({ kind: "tx", txId: tx.id }),
      );
      submittedEl.appendChild(item);
      fadeInItem(item);
    } else if (isDeposit) {
      // Deposit txs land only in the Deposit column — one item per deposit op.
      for (const dep of tx.deposits) {
        const item = makeItem(
          truncate(dep.depositorAddress, 8, 4),
          `${fmtAmountStroops(dep.amount)} XLM`,
        );
        item.title = dep.depositorAddress;
        item.addEventListener(
          "click",
          () => showDetail({ kind: "tx", txId: tx.id }),
        );
        depositEl.appendChild(item);
        fadeInItem(item);
      }
    } else if (isWithdraw) {
      // Withdraw txs land only in the Withdrawn column — one per withdraw op.
      for (const w of tx.withdraws) {
        const item = makeItem(
          truncate(w.recipientAddress, 8, 4),
          `${fmtAmountStroops(w.amount)} XLM`,
        );
        item.title = w.recipientAddress;
        item.addEventListener("click", () =>
          showDetail({
            kind: "withdraw",
            txId: tx.id,
            bundleId: tx.bundles[0]?.id ?? "",
            recipientAddress: w.recipientAddress,
          }));
        withdrawnEl.appendChild(item);
        fadeInItem(item);
      }
    } else {
      // Regular verified send — Verified column only.
      const item = makeItem(truncate(tx.id));
      item.title = tx.id;
      item.addEventListener(
        "click",
        () => showDetail({ kind: "tx", txId: tx.id }),
      );
      verifiedEl.appendChild(item);
      fadeInItem(item);
    }
  }

  // Mode-bar wiring
  liveBtn.addEventListener("click", () => {
    if (mode === "live" || liveBtn.disabled) return;
    mode = "live";
    clearAllColumns();
    updateModeUi();
  });
  rangeBtn.addEventListener("click", () => {
    if (mode === "range") return;
    mode = "range";
    clearAllColumns();
    updateModeUi();
  });
  searchBtn.addEventListener("click", async () => {
    if (mode !== "range") return;
    if (!channelContractId) {
      rangeStatusEl.textContent = "No channel — join a council first.";
      return;
    }
    const fromVal = fromInput.value;
    const toVal = toInput.value;
    if (!fromVal || !toVal) {
      rangeStatusEl.textContent = "Pick from + to first.";
      return;
    }
    searchBtn.disabled = true;
    rangeStatusEl.textContent = "Loading…";
    clearAllColumns();
    try {
      // date inputs return YYYY-MM-DD — anchor from to start-of-day local time,
      // to to end-of-day local time, then convert to ISO.
      const fromIso = new Date(`${fromVal}T00:00:00`).toISOString();
      const toIso = new Date(`${toVal}T23:59:59.999`).toISOString();
      const { data, truncated } = await listTransactions({
        ppPublicKey,
        channelContractId,
        fromIso,
        toIso,
      });
      for (const tx of data) classifyTxIntoColumns(tx);
      syncAllCounts();
      rangeStatusEl.textContent = `${data.length} tx${
        truncated ? " (truncated)" : ""
      }`;
    } catch (err) {
      rangeStatusEl.textContent = err instanceof Error
        ? err.message
        : String(err);
    } finally {
      searchBtn.disabled = false;
    }
  });

  return {
    getMode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      clearAllColumns();
      updateModeUi();
    },
    loadRange(txs) {
      mode = "range";
      clearAllColumns();
      for (const tx of txs) classifyTxIntoColumns(tx);
      updateModeUi();
      syncAllCounts();
    },
    handleEvent(event) {
      if (mode !== "live") return;
      console.debug("[dashboard] event received", event.kind, event.payload);
      switch (event.kind) {
        case "mempool.bundle_added": {
          const item = makeItem(truncate(event.payload.bundleId));
          item.title = event.payload.bundleId;
          mempoolEl.appendChild(item);
          fadeInItem(item);
          trimHistory(mempoolEl);
          break;
        }
        case "mempool.bundle_expired": {
          // No-op: the mempool item ages out on its own 60s timer.
          break;
        }
        case "executor.transaction_submitted": {
          // Add a Submitted item; the prior Mempool items stay until their
          // own 60s lifetime is up.
          const item = makeItem(truncate(event.payload.txHash));
          item.title = event.payload.txHash;
          item.addEventListener(
            "click",
            () => showDetail({ kind: "tx", txId: event.payload.txHash }),
          );
          submittedEl.appendChild(item);
          fadeInItem(item);
          trimHistory(submittedEl);
          break;
        }
        case "executor.execution_failed": {
          // No-op: prior items age out naturally.
          break;
        }
        case "verifier.bundle_completed": {
          const item = makeItem(truncate(event.payload.txId));
          item.title = event.payload.txId;
          item.addEventListener(
            "click",
            () => showDetail({ kind: "tx", txId: event.payload.txId }),
          );
          verifiedEl.appendChild(item);
          fadeInItem(item);
          trimHistory(verifiedEl);
          break;
        }
        case "verifier.bundle_failed": {
          // No-op: prior items age out naturally.
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
          break;
        }
      }
      syncAllCounts();
    },
    setStatus(status) {
      wsStatus = status;
      if (status !== "open" && mode === "live") {
        // WS not available — force Range mode (empty) so the user has a path
        // to query historical data.
        mode = "range";
        clearAllColumns();
      }
      updateModeUi();
    },
  };
}

function renderTxDetail(d: TransactionDetail): string {
  const sendersHtml = d.senders.length
    ? d.senders.map((s) =>
      `<span class="mono" title="${escapeHtml(s)}">${
        escapeHtml(truncate(s, 8, 6))
      }</span>`
    ).join(", ")
    : '<span style="color:var(--text-muted)">unknown</span>';
  const receiversHtml = d.receivers.length
    ? d.receivers.map((r) =>
      `<span class="mono" title="${escapeHtml(r)}">${
        escapeHtml(truncate(r, 8, 6))
      }</span>`
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
      `<li><span class="mono" title="${escapeHtml(u.id)}">${
        escapeHtml(truncate(u.id))
      }</span> — ${fmtAmountStroops(u.amount)} XLM${
        u.spent ? " (spent)" : ""
      }</li>`
    ).join("")
    : '<li style="color:var(--text-muted)">No UTXOs in this tx</li>';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
      <div style="font-weight:600">Transaction</div>
      <span class="badge badge-${
    d.status === "VERIFIED" ? "active" : "pending"
  }">${escapeHtml(d.status)}</span>
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
        <div class="mono" style="font-size:0.75rem">${
    escapeHtml(truncate(u.createdAtBundleId))
  }</div>
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
      `<li><span class="mono" title="${escapeHtml(u.id)}">${
        escapeHtml(truncate(u.id))
      }</span> — ${fmtAmountStroops(u.amount)} XLM</li>`
    ).join("")
    : `<li style="color:var(--text-muted)">No UTXOs in tx record</li>`;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
      <div style="font-weight:600">Withdraw</div>
      <span class="badge badge-${
    d.status === "VERIFIED" ? "active" : "pending"
  }">${escapeHtml(d.status)}</span>
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
