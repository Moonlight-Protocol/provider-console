import { page } from "../components/page.ts";
import { GRAFANA_CONFIG } from "../lib/config.ts";
import { escapeHtml } from "../lib/dom.ts";

function renderAnalyticsContent(): HTMLElement {
  const el = document.createElement("div");
  const { baseUrl, panels } = GRAFANA_CONFIG;

  if (panels.length === 0) {
    el.innerHTML = `
      <h2>Analytics</h2>
      <div class="empty-state">
        <p>No Grafana panels configured.</p>
        <p class="hint-text">
          Add panel embed URLs to <code>window.__CONSOLE_CONFIG__.grafana.panels</code> in your deployment config.
        </p>
        <details>
          <summary>Configuration example</summary>
          <pre><code>window.__CONSOLE_CONFIG__ = {
  ...
  grafana: {
    baseUrl: "${escapeHtml(baseUrl)}",
    panels: [
      {
        title: "Request Latency",
        src: "${escapeHtml(baseUrl)}/d-solo/abc123/provider-dashboard?panelId=1&amp;orgId=1",
        height: 300
      },
      {
        title: "Bundle Throughput",
        src: "${escapeHtml(baseUrl)}/d-solo/abc123/provider-dashboard?panelId=2&amp;orgId=1",
        height: 300
      }
    ]
  }
};</code></pre>
        </details>
      </div>
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
    <div class="grafana-grid">
      ${panelHtml}
    </div>
  `;

  return el;
}

export const analyticsView = page(renderAnalyticsContent);
