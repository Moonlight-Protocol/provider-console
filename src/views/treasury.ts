import { getTreasury } from "../lib/api.ts";
import { page } from "../components/page.ts";
import { renderError, escapeHtml } from "../lib/dom.ts";

interface Balance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

function renderTreasuryContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<h2>Treasury</h2><p>Loading...</p>`;

  getTreasury()
    .then(({ data }) => {
      const d = data as {
        address: string;
        sequence: string;
        balances: Balance[];
        lastModifiedLedger: number;
      };

      const balanceRows = d.balances.map((b) => {
        const asset = b.asset_type === "native" ? "XLM" : (b.asset_code ?? b.asset_type);
        return `<tr><td>${escapeHtml(asset)}</td><td>${escapeHtml(b.balance)}</td></tr>`;
      }).join("");

      el.innerHTML = `
        <h2>Treasury (OpEx Account)</h2>
        <table>
          <tbody>
            <tr><td>Address</td><td class="mono">${escapeHtml(d.address)}</td></tr>
            <tr><td>Sequence</td><td>${escapeHtml(d.sequence)}</td></tr>
            <tr><td>Last Modified Ledger</td><td>${escapeHtml(String(d.lastModifiedLedger))}</td></tr>
          </tbody>
        </table>

        <h3>Balances</h3>
        <table>
          <thead><tr><th>Asset</th><th>Balance</th></tr></thead>
          <tbody>${balanceRows || "<tr><td colspan='2'>No balances</td></tr>"}</tbody>
        </table>
      `;
    })
    .catch((err) => renderError(el, "Treasury", err.message));

  return el;
}

export const treasuryView = page(renderTreasuryContent);
