import { page } from "../components/page.ts";
import { GRAFANA_CONFIG } from "../lib/config.ts";
import { escapeHtml } from "../lib/dom.ts";

function renderAnalyticsContent(): HTMLElement {
  const el = document.createElement("div");
  const { baseUrl, publicDashboardUrl, panels } = GRAFANA_CONFIG;

  const dashboardLink = publicDashboardUrl
    ? `<p><a href="${escapeHtml(publicDashboardUrl)}" target="_blank" rel="noopener" class="dashboard-link">Open full dashboard in Grafana</a></p>`
    : "";

  if (panels.length === 0) {
    el.innerHTML = `
      <h2>Analytics</h2>
      <p class="hint-text">Powered by <a href="${escapeHtml(baseUrl)}" target="_blank" rel="noopener">Grafana</a> — data from OpenTelemetry instrumentation.</p>
      ${dashboardLink}
    `;
    return el;
  }

  const safePanels = panels.filter((p) => {
    try {
      const url = new URL(p.src);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  });

  const panelHtml = safePanels.map((panel) => `
    <div class="grafana-panel">
      <h3>${escapeHtml(panel.title)}</h3>
      <iframe
        src="${escapeHtml(panel.src)}&theme=dark"
        width="100%"
        height="${panel.height ?? 300}"
        frameborder="0"
        loading="lazy"
      ></iframe>
    </div>
  `).join("");

  el.innerHTML = `
    <h2>Analytics</h2>
    <p class="hint-text">Powered by <a href="${escapeHtml(baseUrl)}" target="_blank" rel="noopener">Grafana</a> — data from OpenTelemetry instrumentation.</p>
    ${dashboardLink}
    <div class="grafana-grid">
      ${panelHtml}
    </div>
  `;

  return el;
}

export const analyticsView = page(renderAnalyticsContent);
