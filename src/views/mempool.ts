import { getMempool } from "../lib/api.ts";
import { page } from "../components/page.ts";
import { renderError, escapeHtml } from "../lib/dom.ts";

function renderMempoolContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<h2>Mempool</h2><p>Loading...</p>`;

  getMempool()
    .then(({ data }) => {
      const { stats, config } = data as {
        stats: { totalSlots: number; totalBundles: number; totalWeight: number; averageBundlesPerSlot: number };
        config: {
          slotCapacity: number; expensiveOpWeight: number; cheapOpWeight: number;
          executorIntervalMs: number; verifierIntervalMs: number; ttlCheckIntervalMs: number;
        };
      };

      el.innerHTML = `
        <h2>Mempool</h2>

        <h3>Current State</h3>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(stats.totalSlots))}</span><span class="stat-label">Slots</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(stats.totalBundles))}</span><span class="stat-label">Bundles</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(stats.totalWeight))}</span><span class="stat-label">Total Weight</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(stats.averageBundlesPerSlot.toFixed(1))}</span><span class="stat-label">Avg/Slot</span></div>
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
