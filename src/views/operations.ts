import { getOperations } from "../lib/api.ts";
import { page } from "../components/page.ts";
import { renderError, escapeHtml } from "../lib/dom.ts";

function renderOperationsContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<h2>Operations</h2><p>Loading...</p>`;

  getOperations()
    .then(({ data }) => {
      const { bundles, transactions } = data as {
        bundles: { total: number; pending: number; processing: number; completed: number; expired: number; successRate: string };
        transactions: { total: number; verified: number; failed: number; unverified: number; successRate: string };
      };

      el.innerHTML = `
        <h2>Operations</h2>

        <h3>Bundles</h3>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(bundles.total))}</span><span class="stat-label">Total</span></div>
          <div class="stat-card active"><span class="stat-value">${escapeHtml(String(bundles.completed))}</span><span class="stat-label">Completed</span></div>
          <div class="stat-card pending"><span class="stat-value">${escapeHtml(String(bundles.pending))}</span><span class="stat-label">Pending</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(bundles.processing))}</span><span class="stat-label">Processing</span></div>
          <div class="stat-card inactive"><span class="stat-value">${escapeHtml(String(bundles.expired))}</span><span class="stat-label">Expired</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(bundles.successRate)}</span><span class="stat-label">Success Rate</span></div>
        </div>

        <h3>Transactions</h3>
        <div class="stats-row">
          <div class="stat-card"><span class="stat-value">${escapeHtml(String(transactions.total))}</span><span class="stat-label">Total</span></div>
          <div class="stat-card active"><span class="stat-value">${escapeHtml(String(transactions.verified))}</span><span class="stat-label">Verified</span></div>
          <div class="stat-card inactive"><span class="stat-value">${escapeHtml(String(transactions.failed))}</span><span class="stat-label">Failed</span></div>
          <div class="stat-card pending"><span class="stat-value">${escapeHtml(String(transactions.unverified))}</span><span class="stat-label">Unverified</span></div>
          <div class="stat-card"><span class="stat-value">${escapeHtml(transactions.successRate)}</span><span class="stat-label">Success Rate</span></div>
        </div>
      `;
    })
    .catch((err) => renderError(el, "Operations", err.message));

  return el;
}

export const operationsView = page(renderOperationsContent);
