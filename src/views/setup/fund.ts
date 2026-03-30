import { page } from "../../components/page.ts";
import { escapeHtml } from "../../lib/dom.ts";
import { navigate } from "../../lib/router.ts";
import { getTreasury } from "../../lib/api.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <div style="max-width:520px;margin:0 auto">
      <a href="#/" class="btn-link" style="margin-bottom:1rem;display:inline-block">&larr; Back</a>
      <h2>Fund your treasury</h2>
      <p style="color:var(--text-muted);margin-bottom:1.5rem">
        Your provider needs XLM in its OpEx account to pay network fees. Send XLM to the address below.
      </p>

      <div id="treasury-loading" style="color:var(--text-muted)">Loading account info...</div>
      <div id="treasury-content" hidden></div>
      <p id="treasury-error" class="error-text" hidden></p>
    </div>
  `;

  const loadingEl = el.querySelector("#treasury-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#treasury-content") as HTMLDivElement;
  const errorEl = el.querySelector("#treasury-error") as HTMLParagraphElement;

  async function loadTreasury() {
    loadingEl.hidden = false;
    contentEl.hidden = true;
    errorEl.hidden = true;

    try {
      const data = await getTreasury();
      const xlm = data.balances.find((b) => b.asset_type === "native");
      const balance = xlm ? parseFloat(xlm.balance) : 0;
      const funded = balance > 0;

      loadingEl.hidden = true;
      contentEl.hidden = false;

      contentEl.innerHTML = `
        <div class="stat-card ${funded ? "active" : ""}" style="margin-bottom:1.5rem;padding:1.25rem">
          <span class="stat-label">OpEx Address</span>
          <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.5rem">
            <input type="text" readonly value="${escapeHtml(data.address)}"
              style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.5rem 0.75rem;color:var(--text);font-family:var(--font-mono);font-size:0.75rem" />
            <button id="copy-addr" class="btn-primary" style="padding:0.5rem 1rem;white-space:nowrap">Copy</button>
          </div>
        </div>

        <div class="stat-card ${funded ? "active" : "pending"}" style="margin-bottom:1.5rem;padding:1.25rem">
          <span class="stat-label">Balance</span>
          <span class="stat-value">${balance.toFixed(2)} XLM</span>
          ${funded
            ? '<span class="badge badge-active" style="margin-top:0.5rem">Funded</span>'
            : '<span class="badge badge-pending" style="margin-top:0.5rem">Awaiting funds</span>'
          }
        </div>

        <div style="display:flex;gap:1rem">
          <button id="refresh-btn" class="btn-primary" style="background:var(--border)">Check Balance</button>
          ${funded ? '<button id="done-btn" class="btn-primary">Continue</button>' : ""}
        </div>
      `;

      contentEl.querySelector("#copy-addr")?.addEventListener("click", () => {
        navigator.clipboard.writeText(data.address).then(() => {
          const btn = contentEl.querySelector("#copy-addr") as HTMLButtonElement;
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = "Copy"; }, 2000);
        });
      });

      contentEl.querySelector("#refresh-btn")?.addEventListener("click", loadTreasury);
      contentEl.querySelector("#done-btn")?.addEventListener("click", () => navigate("/"));
    } catch (err) {
      loadingEl.hidden = true;
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.hidden = false;
    }
  }

  loadTreasury();
  return el;
}

export const fundView = page(renderContent);
