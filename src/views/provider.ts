import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import {
  type CouncilMembership,
  getCouncilMembership,
  getTreasury,
  listPps,
  type PpInfo,
  type TreasuryData,
} from "../lib/api.ts";
import { getRouteParams, navigate, onCleanup } from "../lib/router.ts";
import {
  type ConnectionStatus,
  type EventKind,
  EventsClient,
  type ProviderEvent,
} from "../lib/events-client.ts";

const BUFFER_LIMIT = 100;
const SCROLL_TOP_THRESHOLD_PX = 50;

function truncateId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function pluralizeBundles(count: number): string {
  return `${count} bundle${count === 1 ? "" : "s"}`;
}

const KIND_LABEL: Record<EventKind, string> = {
  "mempool.bundle_added": "Mempool",
  "mempool.bundle_expired": "Mempool",
  "executor.transaction_submitted": "Bundle lifecycle",
  "executor.execution_failed": "Bundle lifecycle",
  "verifier.bundle_completed": "Bundle lifecycle",
  "verifier.bundle_failed": "Bundle lifecycle",
  "channel.provider_added": "Channel membership",
  "channel.provider_removed": "Channel membership",
};

function summarize(event: ProviderEvent): string {
  switch (event.kind) {
    case "mempool.bundle_added":
      return `Bundle ${
        truncateId(event.payload.bundleId)
      } added (weight ${event.payload.weight}${
        event.payload.newSlot ? ", new slot" : ""
      })`;
    case "mempool.bundle_expired":
      return `Bundle ${truncateId(event.payload.bundleId)} expired`;
    case "executor.transaction_submitted":
      return `Tx ${truncateId(event.payload.txHash)} submitted (${
        pluralizeBundles(event.payload.bundleIds.length)
      })`;
    case "executor.execution_failed":
      return `Execution failed: ${event.payload.reason}`;
    case "verifier.bundle_completed":
      return `Tx ${truncateId(event.payload.txId)} verified (${
        pluralizeBundles(event.payload.bundleIds.length)
      })`;
    case "verifier.bundle_failed":
      return `Tx ${
        truncateId(event.payload.txId)
      } failed: ${event.payload.reason}`;
    case "channel.provider_added":
      return `Provider added to channel ${
        truncateId(event.payload.channelContractId)
      }`;
    case "channel.provider_removed":
      return `Provider removed from channel ${
        truncateId(event.payload.channelContractId)
      }`;
  }
}

function formatRelative(ts: number, now: number): string {
  const delta = Math.max(0, Math.floor((now - ts) / 1000));
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3_600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3_600)}h ago`;
}

async function renderContent(): Promise<HTMLElement> {
  const root = document.createElement("div");
  const ppPublicKey = getRouteParams().pk;

  if (!ppPublicKey) {
    navigate("/404");
    return root;
  }

  root.innerHTML =
    `<div id="provider-loading" style="color:var(--text-muted);margin:2rem 0">Loading provider...</div>`;

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

  const [membershipResult, treasuryResult] = await Promise.allSettled([
    getCouncilMembership(ppPublicKey),
    getTreasury(ppPublicKey),
  ]);
  const membership: CouncilMembership | null =
    membershipResult.status === "fulfilled" ? membershipResult.value : null;
  const treasury: TreasuryData | null = treasuryResult.status === "fulfilled"
    ? treasuryResult.value
    : null;

  const xlm = treasury?.balances.find((b) => b.asset_type === "native");
  const opexBalance = xlm ? `${parseFloat(xlm.balance).toFixed(2)} XLM` : "—";

  const config = membership?.config as {
    channels?: Array<{ assetCode: string }>;
    jurisdictions?: Array<{ countryCode: string; label: string | null }>;
    providers?: Array<{ publicKey: string; jurisdictions: string[] | null }>;
  } | null;

  const councilCodes = (config?.jurisdictions || []).map((j) =>
    j.countryCode.toUpperCase()
  );
  const ppEntry = (config?.providers || []).find((p) =>
    p.publicKey === ppPublicKey
  );
  const ppCodes = (ppEntry?.jurisdictions || []).map((c) => c.toUpperCase());
  const mergedCodes = Array.from(new Set([...councilCodes, ...ppCodes]));

  const flags = mergedCodes.map((code) => {
    const flag = code.replace(
      /./g,
      (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65),
    );
    return `<span title="${
      escapeHtml(code)
    }" style="font-size:1.2rem">${flag}</span>`;
  }).join(" ");

  const assets = (config?.channels || []).map((ch) =>
    `<span class="badge badge-active" style="margin-right:0.25rem">${
      escapeHtml(ch.assetCode)
    }</span>`
  ).join("");

  const councilName = membership?.councilName || "—";
  const councilStatus = membership?.status ?? null;

  const name = pp.label || truncateId(pp.publicKey);

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem"><a href="#/" class="icon-btn" title="Back" style="color:var(--text)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg></a><h2 style="margin:0">${
    escapeHtml(name)
  }</h2></div>
    <p class="mono" style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1.5rem;word-break:break-all">${
    escapeHtml(pp.publicKey)
  }</p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;max-width:700px;margin-bottom:2rem">
      <div class="stat-card" style="padding:1.25rem">
        <span class="stat-label">OpEx balance</span>
        <span class="stat-value" style="margin:0.5rem 0">${
    escapeHtml(opexBalance)
  }</span>
      </div>

      <div class="stat-card" style="padding:1.25rem">
        <span class="stat-label">Council</span>
        <span class="stat-value" style="font-size:1.1rem;margin:0.5rem 0">${
    escapeHtml(councilName)
  }</span>
        ${
    councilStatus
      ? `<span class="badge badge-${
        councilStatus === "ACTIVE" ? "active" : "pending"
      }">${escapeHtml(councilStatus)}</span>`
      : ""
  }
      </div>

      <div class="stat-card" style="padding:1.25rem">
        <span class="stat-label">Jurisdictions</span>
        <div style="margin-top:0.5rem;font-size:1rem">${flags || "—"}</div>
      </div>

      <div class="stat-card" style="padding:1.25rem">
        <span class="stat-label">Assets</span>
        <div style="margin-top:0.5rem">${assets || "—"}</div>
      </div>
    </div>

    <div class="events-view">
      <div style="display:flex;align-items:baseline;gap:1rem;margin-bottom:1rem">
        <h3 style="margin:0">Events</h3>
        <span id="events-status" class="badge" data-status="connecting">connecting…</span>
      </div>

      <div id="events-list" style="max-height:50vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)"></div>

      <p id="events-empty" style="color:var(--text-muted);margin-top:1rem">
        Waiting for events. New activity will stream in here.
      </p>
    </div>
  `;

  const statusEl = root.querySelector("#events-status") as HTMLSpanElement;
  const listEl = root.querySelector("#events-list") as HTMLDivElement;
  const emptyEl = root.querySelector("#events-empty") as HTMLParagraphElement;

  const buffer: ProviderEvent[] = [];

  function renderList(): void {
    const now = Date.now();
    emptyEl.hidden = buffer.length > 0;
    const atTop = listEl.scrollTop < SCROLL_TOP_THRESHOLD_PX;
    listEl.textContent = "";

    for (const event of buffer) {
      const row = document.createElement("div");
      row.className = "event-row";
      row.style.cssText =
        "display:grid;grid-template-columns:auto auto 1fr;gap:0.75rem;padding:0.6rem 0.9rem;border-bottom:1px solid var(--border);align-items:center";

      const time = document.createElement("span");
      time.className = "event-time";
      time.style.cssText =
        "color:var(--text-muted);font-size:0.8rem;font-variant-numeric:tabular-nums;min-width:5rem";
      time.textContent = formatRelative(event.ts, now);

      const kind = document.createElement("span");
      kind.className = "badge";
      kind.textContent = KIND_LABEL[event.kind];

      const summary = document.createElement("span");
      summary.className = "event-summary";
      summary.textContent = summarize(event);

      row.append(time, kind, summary);
      listEl.appendChild(row);
    }

    if (atTop) listEl.scrollTop = 0;
  }

  function applyStatus(status: ConnectionStatus): void {
    statusEl.dataset.status = status;
    statusEl.textContent = status === "open"
      ? "connected"
      : status === "connecting"
      ? "connecting…"
      : "disconnected";
  }

  renderList();

  const client = new EventsClient({
    ppPublicKey,
    onEvent: (event) => {
      buffer.unshift(event);
      if (buffer.length > BUFFER_LIMIT) buffer.length = BUFFER_LIMIT;
      renderList();
    },
    onStatus: applyStatus,
  });
  client.start();
  onCleanup(() => client.stop());

  return root;
}

export const providerView = page(renderContent);
