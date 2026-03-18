import { getMempool } from "../lib/api.ts";
import { page } from "../components/page.ts";
import { renderError, escapeHtml } from "../lib/dom.ts";

function renderMempoolContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<h2>Mempool</h2><p>Loading...</p>`;

  getMempool()
    .then(({ data }) => {
      const { platformVersion, live, averages, config } = data as {
        platformVersion: string;
        live: { totalSlots: number; totalBundles: number; totalWeight: number; averageBundlesPerSlot: number };
        averages: {
          windowMinutes: number; sampleCount: number;
          avgQueueDepth: number; avgSlotCount: number;
          avgProcessingMs: number; avgThroughputPerMin: number;
        };
        config: {
          slotCapacity: number; expensiveOpWeight: number; cheapOpWeight: number;
          executorIntervalMs: number; verifierIntervalMs: number; ttlCheckIntervalMs: number;
        };
      };

      el.innerHTML = `
        <h2>Mempool <span class="version-badge">v${escapeHtml(platformVersion)}</span></h2>

        <h3>Live</h3>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(live.totalSlots))}</span><span class="stat-label">Slots</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(live.totalBundles))}</span><span class="stat-label">Bundles</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(live.totalWeight))}</span><span class="stat-label">Total Weight</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(live.averageBundlesPerSlot.toFixed(1))}</span><span class="stat-label">Avg/Slot</span></div>
        </div>

        <h3>Averages <span class="hint-text">(last ${averages.windowMinutes}m, ${averages.sampleCount} samples)</span></h3>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(averages.avgQueueDepth))}</span><span class="stat-label">Avg Queue Depth</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(averages.avgSlotCount))}</span><span class="stat-label">Avg Slots</span></div>
          <div class="stat-card"><span class="stat-value">${averages.avgProcessingMs > 0 ? escapeHtml(averages.avgProcessingMs.toFixed(0)) + "ms" : "—"}</span><span class="stat-label">Avg Processing</span></div>
          <div class="stat-card"><span class="stat-value">${averages.avgThroughputPerMin > 0 ? escapeHtml(averages.avgThroughputPerMin.toFixed(1)) : "—"}</span><span class="stat-label">Throughput/min</span></div>
        </div>

        <h3>Configuration</h3>
        <table>
          <tbody>
            <tr><td>Slot Capacity</td><td>${escapeHtml(String(config.slotCapacity))}</td></tr>
            <tr><td>Expensive Op Weight</td><td>${escapeHtml(String(config.expensiveOpWeight))}</td></tr>
            <tr><td>Cheap Op Weight</td><td>${escapeHtml(String(config.cheapOpWeight))}</td></tr>
            <tr><td>Executor Interval</td><td>${escapeHtml(String(config.executorIntervalMs))}ms</td></tr>
            <tr><td>Verifier Interval</td><td>${escapeHtml(String(config.verifierIntervalMs))}ms</td></tr>
            <tr><td>TTL Check Interval</td><td>${escapeHtml(String(config.ttlCheckIntervalMs))}ms</td></tr>
          </tbody>
        </table>
      `;
    })
    .catch((err) => renderError(el, "Mempool", err.message));

  return el;
}

export const mempoolView = page(renderMempoolContent);
