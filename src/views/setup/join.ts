import { page } from "../../components/page.ts";
import { escapeHtml } from "../../lib/dom.ts";
import { navigate } from "../../lib/router.ts";
import { capture } from "../../lib/analytics.ts";
import { discoverCouncil, joinCouncil, type CouncilInfo } from "../../lib/api.ts";

function renderContent(): HTMLElement {
  const el = document.createElement("div");

  el.innerHTML = `
    <div style="max-width:580px;margin:0 auto">
      <a href="#/" class="btn-link" style="margin-bottom:1rem;display:inline-block">&larr; Back</a>
      <h2>Join a Council</h2>
      <p style="color:var(--text-muted);margin-bottom:1.5rem">
        Paste the council's URL to discover and join it.
      </p>

      <div id="discover-form">
        <div class="form-group">
          <label for="council-url">Council URL</label>
          <input type="text" id="council-url" placeholder="https://council-platform.example.com" />
        </div>
        <button id="discover-btn" class="btn-primary">Discover</button>
        <p id="discover-error" class="error-text" style="margin-top:0.75rem" hidden></p>
      </div>

      <div id="council-info" hidden></div>
      <div id="join-form" hidden></div>
      <div id="join-result" hidden></div>
    </div>
  `;

  const urlInput = el.querySelector("#council-url") as HTMLInputElement;
  const discoverBtn = el.querySelector("#discover-btn") as HTMLButtonElement;
  const discoverError = el.querySelector("#discover-error") as HTMLParagraphElement;
  const infoEl = el.querySelector("#council-info") as HTMLDivElement;
  const joinFormEl = el.querySelector("#join-form") as HTMLDivElement;
  const joinResultEl = el.querySelector("#join-result") as HTMLDivElement;

  let discoveredCouncil: CouncilInfo | null = null;

  // Discover
  discoverBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) {
      discoverError.textContent = "Please enter a council URL";
      discoverError.hidden = false;
      return;
    }

    discoverBtn.disabled = true;
    discoverBtn.textContent = "Discovering...";
    discoverError.hidden = true;
    infoEl.hidden = true;
    joinFormEl.hidden = true;

    try {
      discoveredCouncil = await discoverCouncil(url);
      renderCouncilInfo(discoveredCouncil);
      renderJoinForm();
    } catch (err) {
      discoverError.textContent = err instanceof Error ? err.message : "Discovery failed";
      discoverError.hidden = false;
    } finally {
      discoverBtn.disabled = false;
      discoverBtn.textContent = "Discover";
    }
  });

  // Allow Enter key on URL input
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") discoverBtn.click();
  });

  function renderCouncilInfo(council: CouncilInfo) {
    const flags = council.jurisdictions.map((j) => {
      const flag = j.countryCode.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
      return `<span title="${escapeHtml(j.label || j.countryCode)}" style="font-size:1.2rem">${flag}</span>`;
    }).join(" ");

    const assets = council.channels.map((ch) =>
      `<span class="badge badge-active" style="margin-right:0.25rem">${escapeHtml(ch.assetCode)}</span>`
    ).join("");

    infoEl.innerHTML = `
      <div class="stat-card" style="margin:1.5rem 0;padding:1.25rem">
        <h3 style="margin:0 0 0.75rem;color:var(--text);font-size:1rem;text-transform:none;letter-spacing:0">${escapeHtml(council.council.name)}</h3>
        ${council.council.description ? `<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.75rem">${escapeHtml(council.council.description)}</p>` : ""}
        <div style="display:flex;gap:2rem;flex-wrap:wrap">
          <div>
            <span class="stat-label">Jurisdictions</span>
            <div style="margin-top:0.25rem">${flags || '<span style="color:var(--text-muted)">None</span>'}</div>
          </div>
          <div>
            <span class="stat-label">Assets</span>
            <div style="margin-top:0.25rem">${assets || '<span style="color:var(--text-muted)">None</span>'}</div>
          </div>
          <div>
            <span class="stat-label">Providers</span>
            <div style="margin-top:0.25rem">${council.providers.length}</div>
          </div>
        </div>
      </div>
    `;
    infoEl.hidden = false;
  }

  function renderJoinForm() {
    joinFormEl.innerHTML = `
      <h3 style="margin-bottom:0.75rem;color:var(--text);font-size:0.9rem;text-transform:none;letter-spacing:0">Join request details</h3>
      <div class="form-group">
        <label for="join-label">Organization name (optional)</label>
        <input type="text" id="join-label" placeholder="Acme Privacy Inc" />
      </div>
      <div class="form-group">
        <label for="join-email">Contact email (optional)</label>
        <input type="email" id="join-email" placeholder="admin@acme.com" />
      </div>
      <button id="join-btn" class="btn-primary btn-wide" style="margin-top:0.5rem">Request to Join</button>
      <p id="join-error" class="error-text" style="margin-top:0.75rem" hidden></p>
    `;
    joinFormEl.hidden = false;

    const joinBtn = joinFormEl.querySelector("#join-btn") as HTMLButtonElement;
    const joinError = joinFormEl.querySelector("#join-error") as HTMLParagraphElement;

    joinBtn.addEventListener("click", async () => {
      joinBtn.disabled = true;
      joinBtn.textContent = "Submitting...";
      joinError.hidden = true;

      try {
        const label = (joinFormEl.querySelector("#join-label") as HTMLInputElement).value.trim() || undefined;
        const contactEmail = (joinFormEl.querySelector("#join-email") as HTMLInputElement).value.trim() || undefined;

        await joinCouncil({
          councilUrl: discoveredCouncil!.councilUrl,
          label,
          contactEmail,
        });

        capture("provider_join_request_submitted", {
          councilUrl: discoveredCouncil!.councilUrl,
        });

        // Show success
        joinFormEl.hidden = true;
        joinResultEl.innerHTML = `
          <div style="background:rgba(245,158,11,0.08);border:1px solid var(--pending);border-radius:8px;padding:1.25rem;margin-top:1.5rem">
            <p style="color:var(--pending);font-weight:600;margin-bottom:0.25rem">Request submitted</p>
            <p style="font-size:0.85rem;color:var(--text-muted)">
              Your join request has been sent to the council admin. You'll be notified when it's approved.
            </p>
          </div>
          <button id="home-btn" class="btn-primary btn-wide" style="margin-top:1.5rem">Back to Home</button>
        `;
        joinResultEl.hidden = false;
        joinResultEl.querySelector("#home-btn")?.addEventListener("click", () => navigate("/"));
      } catch (err) {
        joinError.textContent = err instanceof Error ? err.message : "Failed to submit join request";
        joinError.hidden = false;
        joinBtn.disabled = false;
        joinBtn.textContent = "Request to Join";
      }
    });
  }

  return el;
}

export const joinView = page(renderContent);
