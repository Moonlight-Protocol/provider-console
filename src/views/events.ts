import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { navigate, onCleanup } from "../lib/router.ts";
import {
  type ConnectionStatus,
  type EventKind,
  EventsClient,
  type ProviderEvent,
} from "../lib/events-client.ts";

const BUFFER_LIMIT = 100;
const SCROLL_TOP_THRESHOLD_PX = 50;

type ChipGroup = "mempool" | "bundle-lifecycle" | "channel-membership";

const KIND_TO_GROUP: Record<EventKind, ChipGroup> = {
  "mempool.bundle_added": "mempool",
  "mempool.bundle_expired": "mempool",
  "executor.transaction_submitted": "bundle-lifecycle",
  "executor.execution_failed": "bundle-lifecycle",
  "verifier.bundle_completed": "bundle-lifecycle",
  "verifier.bundle_failed": "bundle-lifecycle",
  "channel.provider_added": "channel-membership",
  "channel.provider_removed": "channel-membership",
};

const GROUP_LABEL: Record<ChipGroup, string> = {
  "mempool": "Mempool",
  "bundle-lifecycle": "Bundle lifecycle",
  "channel-membership": "Channel membership",
};

const GROUP_ORDER: ChipGroup[] = [
  "mempool",
  "bundle-lifecycle",
  "channel-membership",
];

function truncateId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function pluralizeBundles(count: number): string {
  return `${count} bundle${count === 1 ? "" : "s"}`;
}

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

function renderContent(): HTMLElement {
  const root = document.createElement("div");

  const ppPublicKey = sessionStorage.getItem("selected_pp") ?? "";
  if (!ppPublicKey) {
    navigate("/home");
    return root;
  }

  const activeGroups = new Set<ChipGroup>(GROUP_ORDER);
  const buffer: ProviderEvent[] = [];

  root.innerHTML = `
    <div class="events-view">
      <div style="display:flex;align-items:baseline;gap:1rem;margin-bottom:1rem">
        <h2 style="margin:0">Events</h2>
        <span id="events-status" class="badge" data-status="connecting">connecting…</span>
      </div>

      <div id="events-chips" role="group" aria-label="Filter events" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem"></div>

      <div id="events-list" style="max-height:65vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface)"></div>

      <p id="events-empty" style="color:var(--text-muted);margin-top:1rem">
        Waiting for events. New activity will stream in here.
      </p>
    </div>
  `;

  const statusEl = root.querySelector("#events-status") as HTMLSpanElement;
  const chipsEl = root.querySelector("#events-chips") as HTMLDivElement;
  const listEl = root.querySelector("#events-list") as HTMLDivElement;
  const emptyEl = root.querySelector("#events-empty") as HTMLParagraphElement;

  function renderChips(): void {
    chipsEl.textContent = "";
    for (const group of GROUP_ORDER) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.group = group;
      const isActive = activeGroups.has(group);
      btn.setAttribute("aria-pressed", String(isActive));
      btn.className = isActive ? "chip chip-active" : "chip";
      btn.textContent = GROUP_LABEL[group];
      btn.addEventListener("click", () => {
        if (activeGroups.has(group)) activeGroups.delete(group);
        else activeGroups.add(group);
        renderChips();
        renderList();
      });
      chipsEl.appendChild(btn);
    }
  }

  function renderList(): void {
    const now = Date.now();
    const visible = buffer.filter((e) =>
      activeGroups.has(KIND_TO_GROUP[e.kind])
    );

    emptyEl.hidden = visible.length > 0;

    const atTop = listEl.scrollTop < SCROLL_TOP_THRESHOLD_PX;
    listEl.textContent = "";

    for (const event of visible) {
      const row = document.createElement("div");
      row.className = `event-row event-${KIND_TO_GROUP[event.kind]}`;
      row.style.cssText =
        "display:grid;grid-template-columns:auto auto 1fr;gap:0.75rem;padding:0.6rem 0.9rem;border-bottom:1px solid var(--border);align-items:center";

      const time = document.createElement("span");
      time.className = "event-time";
      time.style.cssText =
        "color:var(--text-muted);font-size:0.8rem;font-variant-numeric:tabular-nums;min-width:5rem";
      time.textContent = formatRelative(event.ts, now);

      const kind = document.createElement("span");
      kind.className = "badge";
      kind.textContent = GROUP_LABEL[KIND_TO_GROUP[event.kind]];

      const summary = document.createElement("span");
      summary.className = "event-summary";
      summary.innerHTML = escapeHtml(summarize(event));

      row.append(time, kind, summary);
      listEl.appendChild(row);
    }

    // Auto-scroll only when the user was already at the top — never yank
    // them mid-scroll while they're inspecting older entries.
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

  renderChips();
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

export const eventsView = page(renderContent);
