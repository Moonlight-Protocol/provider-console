import { getChannels } from "../lib/api.ts";
import { page } from "../components/page.ts";
import { renderError, escapeHtml } from "../lib/dom.ts";

function renderChannelsContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<h2>Channels</h2><p>Loading...</p>`;

  getChannels()
    .then(({ data }) => {
      const { channels, summary } = data as {
        channels: Array<{ contractId: string; state: string; registeredAtLedger: number; removedAtLedger?: number }>;
        summary: { total: number; active: number; pending: number; inactive: number };
      };

      el.innerHTML = `
        <h2>Channels</h2>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(summary.total))}</span><span class="stat-label">Total</span></div>
          <div class="stat-card active"><span class="stat-value">${escapeHtml(String(summary.active))}</span><span class="stat-label">Active</span></div>
          <div class="stat-card pending"><span class="stat-value">${escapeHtml(String(summary.pending))}</span><span class="stat-label">Pending</span></div>
          <div class="stat-card inactive"><span class="stat-value">${escapeHtml(String(summary.inactive))}</span><span class="stat-label">Inactive</span></div>
        </div>
        ${channels.length === 0 ? "<p>No channels detected yet. The event watcher will pick up registrations automatically.</p>" : ""}
        <table>
          <thead><tr><th>Contract ID</th><th>State</th><th>Registered</th><th>Removed</th></tr></thead>
          <tbody>
            ${channels.map((c) => `
              <tr class="state-${escapeHtml(c.state)}">
                <td class="mono">${escapeHtml(c.contractId)}</td>
                <td><span class="badge badge-${escapeHtml(c.state)}">${escapeHtml(c.state)}</span></td>
                <td>${c.registeredAtLedger ? escapeHtml(String(c.registeredAtLedger)) : "—"}</td>
                <td>${c.removedAtLedger ? escapeHtml(String(c.removedAtLedger)) : "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    })
    .catch((err) => renderError(el, "Channels", err.message));

  return el;
}

export const channelsView = page(renderChannelsContent);
