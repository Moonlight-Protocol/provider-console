import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import {
  discoverCouncil,
  getMetrics,
  getTreasury,
  listPps,
  type MembershipInfo,
  type MetricsSnapshot,
  type PpInfo,
  type TreasuryData,
} from "../lib/api.ts";
import { getRouteParams, navigate, onCleanup } from "../lib/router.ts";
import { EventsClient, type ProviderEvent } from "../lib/events-client.ts";
import { getConnectedAddress, signTransaction } from "../lib/wallet.ts";
import { buildFundTx, submitHorizonTx } from "../lib/stellar.ts";
import { API_BASE_URL } from "../lib/config.ts";

// -----------------------------------------------------------------------------
// Shared helpers (unchanged from v1)
// -----------------------------------------------------------------------------

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

function fmtAmountStroops(stroops: string): string {
  const big = BigInt(stroops);
  const whole = big / 10_000_000n;
  const frac = big % 10_000_000n;
  return `${whole}.${frac.toString().padStart(7, "0").slice(0, 2)}`;
}

function fmtRelativeTime(epochMs: number, now: number): string {
  const delta = Math.max(0, now - epochMs);
  if (delta < 1000) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function withBriefCopyFeedback(btn: HTMLElement): void {
  const orig = btn.innerHTML;
  btn.innerHTML =
    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--active)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
  setTimeout(() => {
    btn.innerHTML = orig;
  }, 1200);
}

// -----------------------------------------------------------------------------
// Top-level view
// -----------------------------------------------------------------------------

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

  let treasury: TreasuryData | null = null;
  try {
    treasury = await getTreasury(ppPublicKey);
  } catch { /* best effort */ }

  const xlm = treasury?.balances.find((b) => b.asset_type === "native");
  const opexBalance = xlm ? `${parseFloat(xlm.balance).toFixed(2)} XLM` : "—";
  const name = pp.label || truncate(pp.publicKey);

  // Sibling-PP lists per council: one POST /dashboard/council/discover per
  // membership, in parallel, cached in-memory for the view's lifetime.
  // Best-effort — failures render the council node with no sibling dots.
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

  root.innerHTML = renderTemplate(name, opexBalance, memberships);

  wireHeader(root, pp);
  wireFund(root, pp.publicKey);
  wireCouncils(root);

  // v2 zones (counter strip / topology / activity feed / sparklines).
  const zones = setupV2Zones({
    root,
    ppPublicKey,
    name,
    memberships,
    siblingsByCouncil,
  });

  const client = new EventsClient({
    ppPublicKey,
    onEvent: (event) => zones.handleEvent(event),
    onStatus: (status) => zones.setStatus(status),
  });
  client.start();
  onCleanup(() => {
    client.stop();
    zones.stop();
  });

  return root;
}

// -----------------------------------------------------------------------------
// HTML template
//
// v1 top stays AS-IS (header + OpEx card + 3-up Councils list) per `-3` §4.
// v2 zones land in the space the v1 events UI (5-column + mode toggle +
// tx-detail card) used to occupy.
// -----------------------------------------------------------------------------

function renderTemplate(
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
      <div style="display:flex;align-items:center;gap:0.25rem">
        <button id="copy-provider-url" class="icon-btn" title="Copy provider URL"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
        <button id="copy-opex-address" class="icon-btn" title="Copy OpEx address"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg></button>
        <button id="fund-btn" class="icon-btn" title="Fund OpEx account"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M12 18V6"/></svg></button>
      </div>
    </div>

    <div style="padding:0.6rem 0.9rem;margin-bottom:1.5rem;border:1px solid var(--border);border-radius:8px;background:var(--surface);display:inline-flex;flex-direction:column;align-items:flex-start;gap:0.35rem;text-align:left">
      <span style="color:var(--text-muted);font-size:0.7rem;letter-spacing:0.05em;text-transform:uppercase">OpEx Balance</span>
      <span style="font-size:1.1rem;font-weight:600">${
    escapeHtml(opexBalance)
  }</span>
    </div>
    <p id="fund-error" class="error-text" hidden style="margin:0 0 1rem"></p>

    <h3 style="margin:0 0 0.5rem">Councils</h3>
    <div id="councils" style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:2rem">${councilCards}</div>

    <div class="dashboard-v2" style="display:grid;grid-template-columns:1fr 280px;grid-template-areas:'counter counter' 'topology feed' 'sparklines sparklines';gap:0.75rem">
      <div class="zone-counter" style="grid-area:counter;display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem">
        ${
    renderCounterBox("throughput", "Throughput", "last 15m", "bundles/min")
  }
        ${renderCounterBox("latency", "Avg Latency", "last 100 bundles", "ms")}
        ${renderCounterBox("queue", "Queue Depth", "now", "in mempool")}
        ${renderCounterBox("error-rate", "Error Rate", "1h", "of bundles")}
      </div>

      <div class="zone-topology stat-card" style="grid-area:topology;padding:0.75rem;overflow:auto">
        ${renderTopologyContainer(name, memberships)}
      </div>

      <div class="zone-feed stat-card" style="grid-area:feed;padding:0.75rem;min-height:${TOPOLOGY_HEIGHT}px;display:flex;flex-direction:column">
        <div style="font-weight:600;margin-bottom:0.5rem">Activity</div>
        <div id="activity-feed" style="flex:1;display:flex;flex-direction:column;gap:0.4rem;overflow:hidden"></div>
        <div id="activity-feed-empty" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;text-align:center">No events yet.</div>
      </div>

      <div class="zone-sparklines" style="grid-area:sparklines;display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;min-height:180px">
        ${
    renderSparklineBox("throughput", "Throughput (bundles/min)", "#1c7ed6")
  }
        ${
    renderSparklineBox("latency", "Latency mempool→verified (s)", "#7950f2")
  }
        ${renderSparklineBox("queue", "Queue depth", "#2f9e44")}
      </div>
    </div>
  `;
}

function renderCounterBox(
  id: string,
  label: string,
  window: string,
  unit: string,
): string {
  return `
    <div class="zone-counter-box stat-card" style="padding:0.6rem 0.8rem;border-color:#1971c2;background:#e7f5ff">
      <div style="font-size:0.65rem;letter-spacing:0.06em;text-transform:uppercase;color:#1864ab;font-weight:600">${
    escapeHtml(label)
  }</div>
      <div style="font-size:0.65rem;color:#555">${escapeHtml(window)}</div>
      <div style="display:flex;align-items:baseline;gap:0.3rem;margin-top:0.2rem">
        <span id="counter-${id}-value" style="font-size:1.4rem;font-weight:700;color:#1864ab">—</span>
        <span style="font-size:0.65rem;color:#555">${escapeHtml(unit)}</span>
      </div>
    </div>
  `;
}

function renderSparklineBox(id: string, label: string, color: string): string {
  return `
    <div class="zone-sparkline-box stat-card" style="padding:0.6rem 0.8rem;display:flex;flex-direction:column;gap:0.3rem">
      <div style="font-size:0.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em">${
    escapeHtml(label)
  }</div>
      <svg id="sparkline-${id}" viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" preserveAspectRatio="none" style="flex:1;width:100%;height:auto;min-height:120px">
        <polyline fill="none" stroke="${color}" stroke-width="1.5" points=""></polyline>
        <text x="${SPARKLINE_WIDTH / 2}" y="${
    SPARKLINE_HEIGHT /
    2
  }" text-anchor="middle" dominant-baseline="middle" fill="var(--text-muted)" font-size="10" id="sparkline-${id}-empty">—</text>
      </svg>
    </div>
  `;
}

function renderCouncilCard(m: MembershipInfo): string {
  const merged = mergedJurisdictions(m);
  const flagsHtml = merged.length ? flags(merged) : "—";
  const assetChips = m.channels.length
    ? m.channels.map((c) =>
      `<span class="badge badge-active" style="margin-right:0.25rem">${
        escapeHtml(c.assetCode)
      }</span>`
    ).join("")
    : '<span style="color:var(--text-muted);font-size:0.85rem">No assets yet</span>';
  return `
    <div class="stat-card" style="padding:0.75rem 1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">
        <span style="font-weight:600">${escapeHtml(m.councilName || "—")}</span>
        <div>${flagsHtml}</div>
      </div>
      <div style="display:flex;gap:0.25rem;flex-wrap:wrap">${assetChips}</div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// v1 header / fund / councils wiring (unchanged paths)
// -----------------------------------------------------------------------------

function wireHeader(root: HTMLElement, pp: PpInfo): void {
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

function wireCouncils(_root: HTMLElement): void {
  // v1 had asset-chip click-to-copy on the 3-up council cards. Dropped per
  // `-3` §5 ("Asset-chip-copy — PM confirmed drop; do not restore.").
  // The 3-up render itself stays per `-3` §4.
}

// -----------------------------------------------------------------------------
// v2 zones — topology + counter strip + activity feed + sparklines
// All zones are always-live: no Range mode, no Search, no mode toggle.
// -----------------------------------------------------------------------------

const TOPOLOGY_WIDTH = 850;
const TOPOLOGY_HEIGHT = 470;
const TOPOLOGY_CENTER_X = TOPOLOGY_WIDTH / 2;
const TOPOLOGY_CENTER_Y = TOPOLOGY_HEIGHT / 2;
const COUNCIL_RING_RADIUS = 180;
const SIBLING_DOTS_VISIBLE = 10;

const SPARKLINE_WIDTH = 300;
const SPARKLINE_HEIGHT = 80;

const METRICS_POLL_MS = 60_000;
const SPARKLINE_RANGE_MIN = 60;
const FEED_MAX_CARDS = 5;
const FEED_CARD_LIFETIME_MS = 8_000;
const FEED_CARD_FADE_MS = 300;
const PULSE_DURATION_MS = 1_000;
const COUNCIL_ACTIVITY_WINDOW_MS = 5 * 60_000;
const COUNCIL_ACTIVITY_HIGH = 10;
const COUNCIL_ACTIVITY_LOW = 3;

const PULSE_COLORS: Record<ProviderEvent["kind"], string> = {
  "bundle.deposit_completed": "#fab005",
  "mempool.bundle_added": "#1c7ed6",
  "mempool.bundle_expired": "#868e96",
  "executor.transaction_submitted": "#37b24d",
  "executor.execution_failed": "#fa5252",
  "verifier.bundle_completed": "#7950f2",
  "verifier.bundle_failed": "#fa5252",
  "bundle.withdraw_completed": "#fd7e14",
  "channel.provider_added": "#868e96",
  "channel.provider_removed": "#868e96",
};

const FEED_LABELS: Record<ProviderEvent["kind"], string> = {
  "bundle.deposit_completed": "Deposit",
  "mempool.bundle_added": "Mempool",
  "mempool.bundle_expired": "Expired",
  "executor.transaction_submitted": "Submitted",
  "executor.execution_failed": "Execution failed",
  "verifier.bundle_completed": "Verified",
  "verifier.bundle_failed": "Verify failed",
  "bundle.withdraw_completed": "Withdraw",
  "channel.provider_added": "Channel joined",
  "channel.provider_removed": "Channel left",
};

function councilNodePosition(
  index: number,
  total: number,
): { x: number; y: number } {
  const theta = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(total, 1);
  return {
    x: TOPOLOGY_CENTER_X + COUNCIL_RING_RADIUS * Math.cos(theta),
    y: TOPOLOGY_CENTER_Y + COUNCIL_RING_RADIUS * Math.sin(theta),
  };
}

function renderTopologyContainer(
  name: string,
  memberships: MembershipInfo[],
): string {
  const positions = memberships.map((_, i) =>
    councilNodePosition(i, memberships.length)
  );

  const edges = positions
    .map(
      (p, i) =>
        `<line data-council-edge="${i}" x1="${TOPOLOGY_CENTER_X}" y1="${TOPOLOGY_CENTER_Y}" x2="${p.x}" y2="${p.y}" stroke="var(--border)" stroke-width="2" />`,
    )
    .join("");

  const councilNodeBoxes = memberships
    .map((m, i) => renderCouncilNodeBox(m, i, positions[i]))
    .join("");

  const emptyState = memberships.length === 0
    ? `<div class="topology-empty" style="position:absolute;left:50%;top:80%;transform:translate(-50%,-50%);color:var(--text-muted);font-size:0.85rem;text-align:center">No council memberships yet.</div>`
    : "";

  return `
    <div id="topology" class="topology" style="position:relative;width:${TOPOLOGY_WIDTH}px;height:${TOPOLOGY_HEIGHT}px;margin:0 auto">
      <svg id="topology-svg" viewBox="0 0 ${TOPOLOGY_WIDTH} ${TOPOLOGY_HEIGHT}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
        ${edges}
      </svg>
      <div class="topology-my-pp" style="position:absolute;left:${TOPOLOGY_CENTER_X}px;top:${TOPOLOGY_CENTER_Y}px;transform:translate(-50%,-50%);width:160px;height:160px;background:#fff3bf;color:#1a1a1a;border:3px solid #1a1a1a;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;padding:0.5rem">
        <span style="font-weight:700;font-size:0.9rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${
    escapeHtml(name)
  }">${escapeHtml(name)}</span>
      </div>
      ${councilNodeBoxes}
      ${emptyState}
    </div>
  `;
}

function renderCouncilNodeBox(
  m: MembershipInfo,
  index: number,
  pos: { x: number; y: number },
): string {
  const merged = mergedJurisdictions(m);
  const flagsHtml = merged.length ? flags(merged) : "";
  const assetCount = m.channels.length;
  return `
    <div class="topology-council-node" data-council-index="${index}" data-activity="idle" style="position:absolute;left:${pos.x}px;top:${pos.y}px;transform:translate(-50%,-50%);width:170px;background:#e9ecef;border:2px solid #868e96;border-radius:14px;padding:0.5rem 0.6rem;display:flex;flex-direction:column;gap:0.3rem">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
        <span style="font-weight:600;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${
    escapeHtml(m.councilName ?? "—")
  }">${escapeHtml(m.councilName ?? "—")}</span>
        <span style="font-size:0.85rem">${flagsHtml}</span>
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;font-size:0.7rem;color:#555">
        <span class="topology-activity-tag" style="background:#fff;border:1px solid currentColor;padding:0.05rem 0.35rem;border-radius:10px">idle</span>
        <span>${assetCount} asset${assetCount === 1 ? "" : "s"}</span>
      </div>
      <div class="topology-sibling-dots" data-council-siblings="${index}" style="display:flex;flex-wrap:wrap;gap:3px;min-height:14px"></div>
      <div class="topology-sibling-caption" data-council-caption="${index}" style="font-size:0.65rem;color:#555;text-align:center">—</div>
    </div>
  `;
}

interface SetupOpts {
  root: HTMLElement;
  ppPublicKey: string;
  name: string;
  memberships: MembershipInfo[];
  siblingsByCouncil: Map<
    string,
    Array<{ publicKey: string; label: string | null }>
  >;
}

interface ZoneHandle {
  handleEvent: (event: ProviderEvent) => void;
  setStatus: (status: "connecting" | "open" | "closed") => void;
  stop: () => void;
}

function setupV2Zones(opts: SetupOpts): ZoneHandle {
  const { root, ppPublicKey, memberships, siblingsByCouncil } = opts;

  // Sibling dots are rendered post-mount so we don't have to escape into the
  // big template string.
  memberships.forEach((m, i) => {
    const dotsEl = root.querySelector(
      `[data-council-siblings="${i}"]`,
    ) as HTMLElement | null;
    const captionEl = root.querySelector(
      `[data-council-caption="${i}"]`,
    ) as HTMLElement | null;
    if (!dotsEl || !captionEl) return;
    const siblings = siblingsByCouncil.get(m.councilUrl) ?? [];
    const visible = siblings.slice(0, SIBLING_DOTS_VISIBLE);
    const overflow = siblings.length - visible.length;
    dotsEl.innerHTML = visible.map((s) =>
      `<span class="topology-sibling-dot" title="${
        escapeHtml(s.label ?? s.publicKey)
      }" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#868e96"></span>`
    ).join("") +
      (overflow > 0
        ? `<span style="font-size:0.65rem;color:#555;align-self:center">+${overflow}</span>`
        : "");
    captionEl.textContent = siblings.length === 0
      ? "— no sibling PPs yet —"
      : `(${siblings.length} sibling PP${siblings.length === 1 ? "" : "s"})`;
  });

  const svg = root.querySelector("#topology-svg") as SVGSVGElement | null;
  const feedEl = root.querySelector("#activity-feed") as HTMLElement | null;
  const feedEmptyEl = root.querySelector(
    "#activity-feed-empty",
  ) as HTMLElement | null;

  // channelContractId → council index + label, for routing pulses to the right
  // edge and resolving feed-card subtitles. Stable for the view's lifetime.
  const channelToCouncil = new Map<
    string,
    { index: number; councilName: string | null }
  >();
  memberships.forEach((m, i) => {
    for (const ch of m.channels) {
      channelToCouncil.set(ch.channelContractId, {
        index: i,
        councilName: m.councilName,
      });
    }
  });

  // Per-council rolling pulse timestamps; entries older than the activity
  // window are dropped on each event.
  const councilPulses = new Map<number, number[]>();

  function bucketActivity(count: number): {
    label: "high" | "low" | "idle";
    fill: string;
    stroke: string;
  } {
    if (count >= COUNCIL_ACTIVITY_HIGH) {
      return { label: "high", fill: "#d3f9d8", stroke: "#2f9e44" };
    }
    if (count >= COUNCIL_ACTIVITY_LOW) {
      return { label: "low", fill: "#fff3bf", stroke: "#f59f00" };
    }
    return { label: "idle", fill: "#e9ecef", stroke: "#868e96" };
  }

  function recolorCouncil(index: number): void {
    const stamps = councilPulses.get(index) ?? [];
    const cutoff = Date.now() - COUNCIL_ACTIVITY_WINDOW_MS;
    const fresh = stamps.filter((t) => t >= cutoff);
    councilPulses.set(index, fresh);
    const node = root.querySelector(
      `[data-council-index="${index}"]`,
    ) as HTMLElement | null;
    if (!node) return;
    const { label, fill, stroke } = bucketActivity(fresh.length);
    node.style.background = fill;
    node.style.borderColor = stroke;
    node.dataset.activity = label;
    const tag = node.querySelector(
      ".topology-activity-tag",
    ) as HTMLElement | null;
    if (tag) {
      tag.textContent = label;
      tag.style.color = stroke;
    }
  }

  function animatePulse(councilIndex: number, color: string): void {
    if (!svg) return;
    const pos = councilNodePosition(councilIndex, memberships.length);
    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circle.setAttribute("r", "7");
    circle.setAttribute("fill", color);
    circle.setAttribute("cx", String(TOPOLOGY_CENTER_X));
    circle.setAttribute("cy", String(TOPOLOGY_CENTER_Y));
    circle.setAttribute("opacity", "0");
    svg.appendChild(circle);
    const t0 = performance.now();
    function step(now: number): void {
      const t = Math.min(1, (now - t0) / PULSE_DURATION_MS);
      const x = TOPOLOGY_CENTER_X + (pos.x - TOPOLOGY_CENTER_X) * t;
      const y = TOPOLOGY_CENTER_Y + (pos.y - TOPOLOGY_CENTER_Y) * t;
      const alpha = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("opacity", String(Math.max(0, Math.min(1, alpha))));
      if (t < 1) requestAnimationFrame(step);
      else circle.remove();
    }
    requestAnimationFrame(step);
  }

  function pushFeedCard(event: ProviderEvent): void {
    if (!feedEl) return;
    const channelId = (event.payload as { channelContractId?: string | null })
      .channelContractId ??
      null;
    const matched = channelId ? channelToCouncil.get(channelId) : undefined;
    const councilLabel = matched?.councilName ?? "—";
    const color = PULSE_COLORS[event.kind];
    const kindLabel = FEED_LABELS[event.kind];

    let amountHtml = "";
    if (event.kind === "bundle.deposit_completed") {
      amountHtml =
        `<span style="margin-left:auto;font-size:0.7rem;color:#333">${
          fmtAmountStroops(event.payload.amount)
        } XLM</span>`;
    } else if (event.kind === "bundle.withdraw_completed") {
      amountHtml =
        `<span style="margin-left:auto;font-size:0.7rem;color:#333">${
          fmtAmountStroops(event.payload.amount)
        } XLM</span>`;
    }

    const ts = Date.now();
    const card = document.createElement("div");
    card.className = "activity-feed-card";
    card.dataset.ts = String(ts);
    card.style.cssText =
      `border-left:4px solid ${color};background:var(--surface);padding:0.4rem 0.55rem;border-radius:6px;font-size:0.8rem;opacity:0;transition:opacity ${FEED_CARD_FADE_MS}ms`;
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.5rem">
        <span style="font-weight:600">${escapeHtml(kindLabel)}</span>
        ${amountHtml}
      </div>
      <div style="display:flex;justify-content:space-between;color:#555;font-size:0.7rem;margin-top:0.15rem">
        <span title="${escapeHtml(channelId ?? "")}">${
      escapeHtml(councilLabel)
    }</span>
        <span class="activity-feed-relative">just now</span>
      </div>
    `;
    feedEl.prepend(card);
    if (feedEmptyEl) feedEmptyEl.style.display = "none";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.style.opacity = "1";
      });
    });

    while (feedEl.childElementCount > FEED_MAX_CARDS) {
      feedEl.lastElementChild?.remove();
    }

    setTimeout(() => {
      card.style.opacity = "0";
      setTimeout(() => {
        card.remove();
        if (feedEl.childElementCount === 0 && feedEmptyEl) {
          feedEmptyEl.style.display = "";
        }
      }, FEED_CARD_FADE_MS);
    }, FEED_CARD_LIFETIME_MS);
  }

  // Counter strip + sparklines: /dashboard/metrics polled every 60s (same
  // cadence as the platform's MetricsCollector snapshot loop).

  function applyMetrics(resp: { snapshots: MetricsSnapshot[] }): void {
    const snapshots = resp.snapshots;

    // Snapshots arrive newest→oldest from the handler.
    setCounter("queue", snapshots[0]?.queueDepth ?? null, (v) => String(v));

    // THROUGHPUT (last 15m): mean of `throughputPerMin` across snapshots in
    // the last 15 minutes.
    const cutoff15 = Date.now() - 15 * 60_000;
    const recent15 = snapshots.filter(
      (s) => new Date(s.recordedAt).getTime() >= cutoff15,
    );
    const throughputValues = recent15
      .map((s) => s.throughputPerMin)
      .filter((v): v is number => typeof v === "number");
    const meanThroughput = throughputValues.length > 0
      ? throughputValues.reduce((a, b) => a + b, 0) / throughputValues.length
      : null;
    setCounter("throughput", meanThroughput, (v) => v.toFixed(2));

    // AVG LATENCY (last 100 bundles): weighted avg of avgProcessingMs across
    // newest snapshots until cumulative bundlesCompleted ≥ 100. Falls back to
    // whatever we have if fewer than 100 completed in the window.
    let weightSum = 0;
    let weightedLatency = 0;
    for (const s of snapshots) {
      if (s.avgProcessingMs == null) continue;
      weightedLatency += s.avgProcessingMs * s.bundlesCompleted;
      weightSum += s.bundlesCompleted;
      if (weightSum >= 100) break;
    }
    const avgLatency = weightSum > 0 ? weightedLatency / weightSum : null;
    setCounter("latency", avgLatency, (v) => v.toFixed(0));

    // ERROR RATE (1h): bundlesFailed / (bundlesCompleted + bundlesFailed +
    // bundlesExpired). Requires bundlesFailed on every snapshot — pre-PR-104
    // platforms omit the field, in which case we show "—" rather than a
    // misleading 0%.
    const hasFailureData = snapshots.length > 0 &&
      snapshots.every((s) => typeof s.bundlesFailed === "number");
    if (hasFailureData) {
      let failed = 0;
      let terminal = 0;
      for (const s of snapshots) {
        failed += s.bundlesFailed ?? 0;
        terminal += (s.bundlesFailed ?? 0) + s.bundlesCompleted +
          s.bundlesExpired;
      }
      const rate = terminal > 0 ? (failed / terminal) * 100 : 0;
      setCounter("error-rate", rate, (v) => `${v.toFixed(1)}%`);
    } else {
      setCounter("error-rate", null, () => "—");
    }

    drawSparkline(
      "throughput",
      snapshots,
      (s) => s.throughputPerMin,
    );
    drawSparkline(
      "latency",
      snapshots,
      (s) => s.avgProcessingMs == null ? null : s.avgProcessingMs / 1000,
    );
    drawSparkline("queue", snapshots, (s) => s.queueDepth);
  }

  function setCounter(
    id: string,
    value: number | null,
    fmt: (v: number) => string,
  ): void {
    const el = root.querySelector(
      `#counter-${id}-value`,
    ) as HTMLElement | null;
    if (!el) return;
    el.textContent = value == null ? "—" : fmt(value);
  }

  function drawSparkline(
    id: string,
    snapshots: MetricsSnapshot[],
    pick: (s: MetricsSnapshot) => number | null,
  ): void {
    const svgEl = root.querySelector(
      `#sparkline-${id}`,
    ) as SVGSVGElement | null;
    if (!svgEl) return;
    const polyline = svgEl.querySelector("polyline");
    const empty = svgEl.querySelector(`#sparkline-${id}-empty`) as
      | SVGTextElement
      | null;
    if (!polyline) return;

    // Server returns newest→oldest; reverse so x grows with time.
    const ordered = [...snapshots].reverse();
    const values = ordered.map(pick);

    if (values.every((v) => v == null)) {
      polyline.setAttribute("points", "");
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";

    const finiteValues = values.filter((v): v is number => v != null);
    const minV = Math.min(...finiteValues, 0);
    const maxV = Math.max(...finiteValues, minV + 1);
    const range = maxV - minV;
    const n = values.length;
    const pairs: Array<{ x: number; y: number }> = [];
    values.forEach((v, i) => {
      if (v == null) return;
      const x = n === 1 ? SPARKLINE_WIDTH / 2 : (i / (n - 1)) * SPARKLINE_WIDTH;
      const yNorm = range === 0 ? 0.5 : (v - minV) / range;
      const y = SPARKLINE_HEIGHT - yNorm * SPARKLINE_HEIGHT;
      pairs.push({ x, y });
    });

    polyline.setAttribute(
      "points",
      pairs.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    );
  }

  // Refresh activity-feed cards' "Xs ago" subtitle so the relative time stays
  // current between events.
  const tickerInterval = globalThis.setInterval(() => {
    const now = Date.now();
    root.querySelectorAll(".activity-feed-card").forEach((card) => {
      const ts = Number((card as HTMLElement).dataset.ts ?? 0);
      const rel = card.querySelector(".activity-feed-relative");
      if (rel && ts) rel.textContent = fmtRelativeTime(ts, now);
    });
  }, 1000);

  let metricsTimer: number | null = null;
  let stopped = false;

  async function pollMetrics(): Promise<void> {
    if (stopped) return;
    try {
      const data = await getMetrics(ppPublicKey, SPARKLINE_RANGE_MIN);
      if (!stopped) applyMetrics(data);
    } catch (err) {
      console.warn("[v2-zones] metrics poll failed", err);
    } finally {
      if (!stopped) {
        metricsTimer = globalThis.setTimeout(
          pollMetrics,
          METRICS_POLL_MS,
        ) as unknown as number;
      }
    }
  }
  void pollMetrics();

  return {
    handleEvent(event) {
      const channelId = (event.payload as { channelContractId?: string | null })
        .channelContractId ?? null;
      const matched = channelId ? channelToCouncil.get(channelId) : undefined;

      if (matched) {
        const stamps = councilPulses.get(matched.index) ?? [];
        stamps.push(Date.now());
        councilPulses.set(matched.index, stamps);
        recolorCouncil(matched.index);
        animatePulse(matched.index, PULSE_COLORS[event.kind]);
      }
      pushFeedCard(event);
    },
    setStatus(_status) {
      // Always-live: no Range fallback. EventsClient handles WS reconnect
      // exponentially; the UI doesn't flip modes.
    },
    stop() {
      stopped = true;
      if (metricsTimer !== null) globalThis.clearTimeout(metricsTimer);
      globalThis.clearInterval(tickerInterval);
    },
  };
}

export const providerView = page(renderContent);
