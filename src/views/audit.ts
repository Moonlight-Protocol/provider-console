import { getAuditExport } from "../lib/api.ts";
import { capture } from "../lib/analytics.ts";
import { page } from "../components/page.ts";

function renderAuditContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `
    <h2>Audit Export</h2>
    <p>Export bundle data as CSV for compliance reporting.</p>
    <div class="form-row">
      <div class="form-group">
        <label for="audit-status">Status</label>
        <select id="audit-status">
          <option value="COMPLETED" selected>Completed</option>
          <option value="PENDING">Pending</option>
          <option value="PROCESSING">Processing</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>
      <div class="form-group">
        <label for="audit-from">From</label>
        <input type="date" id="audit-from" />
      </div>
      <div class="form-group">
        <label for="audit-to">To</label>
        <input type="date" id="audit-to" />
      </div>
      <button id="audit-export-btn" class="btn-primary">Export CSV</button>
    </div>
    <p id="audit-error" class="error-text" hidden></p>
  `;

  const btn = el.querySelector("#audit-export-btn") as HTMLButtonElement;
  const statusSelect = el.querySelector("#audit-status") as HTMLSelectElement;
  const fromInput = el.querySelector("#audit-from") as HTMLInputElement;
  const toInput = el.querySelector("#audit-to") as HTMLInputElement;
  const errorEl = el.querySelector("#audit-error") as HTMLParagraphElement;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Exporting...";
    errorEl.hidden = true;

    try {
      const csv = await getAuditExport(
        statusSelect.value,
        fromInput.value || undefined,
        toInput.value || undefined,
      );

      // Trigger download
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${statusSelect.value}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      capture("audit_export", { status: statusSelect.value });
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Export failed";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Export CSV";
    }
  });

  return el;
}

export const auditView = page(renderAuditContent);
