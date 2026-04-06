import { page } from "../components/page.ts";
import { escapeHtml } from "../lib/dom.ts";
import { navigate } from "../lib/router.ts";
import { listPps, registerPp, deletePp, checkMembershipStatus, discoverCouncil, joinCouncil, type PpInfo, type CouncilInfo } from "../lib/api.ts";
import { capture } from "../lib/analytics.ts";
import { derivePpKeypair } from "../lib/wallet.ts";
import { COUNTRY_CODES } from "../lib/jurisdictions.ts";


function truncate(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key;
}

function renderContent(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = `<div id="home-loading" style="color:var(--text-muted);margin:2rem 0">Loading providers...</div><div id="home-content" hidden></div>`;

  const loadingEl = el.querySelector("#home-loading") as HTMLDivElement;
  const contentEl = el.querySelector("#home-content") as HTMLDivElement;

  let knownPps: PpInfo[] = [];

  async function loadAndRender() {
    loadingEl.hidden = false;
    contentEl.hidden = true;

    try {
      knownPps = await listPps();

      loadingEl.hidden = true;
      contentEl.hidden = false;
      renderPpList(knownPps);

      // Auto-refresh any PENDING memberships in the background
      const pendingPps = knownPps.filter((pp) => pp.councilMembership?.status === "PENDING");
      for (const pp of pendingPps) {
        checkMembershipStatus(pp.publicKey).then((status) => {
          if (status === "PENDING") return;
          const badge = contentEl.querySelector(`.check-status-btn[data-pp-key="${pp.publicKey}"]`);
          if (!badge) return;
          if (status === "ACTIVE") {
            (badge as HTMLElement).className = "badge badge-active";
            badge.textContent = "ACTIVE";
          } else if (status === "REJECTED") {
            (badge as HTMLElement).className = "badge badge-inactive";
            badge.textContent = "REJECTED";
          }
        }).catch(() => {});
      }
    } catch (err) {
      loadingEl.hidden = true;
      contentEl.hidden = false;
      contentEl.innerHTML = `<p class="error-text">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>`;
    }
  }

  function renderPpList(pps: PpInfo[]) {
    const rows = pps.map((pp) => {
      const meta = JSON.parse(localStorage.getItem(`pp_meta_${pp.publicKey}`) || "{}");
      const statusClass = pp.councilMembership?.status === "ACTIVE" ? "active" : pp.councilMembership?.status === "PENDING" ? "pending" : "inactive";
      const jurisdictions = Array.isArray(meta.jurisdictions)
        ? meta.jurisdictions.map((code: string) =>
            code.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
          ).join(" ")
        : "";
      const councilCell = pp.councilMembership?.councilName
        ? escapeHtml(pp.councilMembership.councilName)
        : '<span style="color:var(--text-muted)">-</span>';
      const statusCell = pp.councilMembership
        ? pp.councilMembership.status === "PENDING"
          ? `<span class="badge badge-pending check-status-btn" data-pp-key="${escapeHtml(pp.publicKey)}" title="Check for updates" style="cursor:pointer">${escapeHtml(pp.councilMembership.status)}</span>`
          : `<span class="badge badge-${statusClass}">${escapeHtml(pp.councilMembership.status)}</span>`
        : `<span class="badge join-council-btn" data-pp-key="${escapeHtml(pp.publicKey)}" style="cursor:pointer;background:rgba(99,102,241,0.15);color:var(--primary)">JOIN</span>`;
      return `
        <tr data-pp="${escapeHtml(pp.publicKey)}" style="cursor:pointer">
          <td${meta.contactEmail ? ` title="${escapeHtml(meta.contactEmail)}"` : ""}>${escapeHtml(pp.label || truncate(pp.publicKey))}</td>
          <td>${jurisdictions}</td>
          <td>${councilCell}</td>
          <td>${statusCell}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="icon-btn copy-addr-btn" data-addr="${escapeHtml(pp.publicKey)}" title="Copy address"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            <button class="icon-btn delete-pp-btn" data-pp-key="${escapeHtml(pp.publicKey)}" title="Delete provider"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
          </td>
        </tr>
      `;
    }).join("");

    contentEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h2 style="margin:0">Providers</h2>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <button id="recover-btn" class="icon-btn" title="Recover providers"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.1 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.589 3.588A2.4 2.4 0 0 1 20 8v3.25"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="m21 22-2.88-2.88"/><circle cx="16" cy="17" r="3"/></svg></button>
          <button id="create-pp-btn" class="icon-btn" title="New Provider"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
        </div>
      </div>
      ${pps.length === 0
        ? `<div class="empty-state"><p>No providers yet. Create one to get started.</p></div>`
        : `<table>
            <thead><tr><th>Name</th><th>Jurisdictions</th><th>Council</th><th>Status</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
      }
    `;

    // Wire recover button
    contentEl.querySelector("#recover-btn")?.addEventListener("click", () => {
      navigate("/recover");
    });

    // Wire create PP button → setup flow
    contentEl.querySelector("#create-pp-btn")?.addEventListener("click", () => {
      navigate("/setup/metadata");
    });

    // Wire copy address buttons
    contentEl.querySelectorAll(".copy-addr-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const addr = (btn as HTMLElement).dataset.addr!;
        navigator.clipboard.writeText(addr).then(() => {
          const orig = btn.innerHTML;
          btn.textContent = "\u2713";
          setTimeout(() => { btn.innerHTML = orig; }, 1500);
        });
      });
    });

    // Wire PENDING status check
    contentEl.querySelectorAll(".check-status-btn").forEach((badge) => {
      badge.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ppKey = (badge as HTMLElement).dataset.ppKey!;
        badge.textContent = "Checking...";
        try {
          const result = await checkMembershipStatus(ppKey);
          if (result === "ACTIVE") {
            (badge as HTMLElement).className = "badge badge-active";
            badge.textContent = "ACTIVE";
          } else if (result === "REJECTED") {
            (badge as HTMLElement).className = "badge badge-inactive";
            badge.textContent = "REJECTED";
          } else {
            badge.textContent = "PENDING";
          }
        } catch {
          badge.textContent = "PENDING";
        }
      });
    });

    // Wire join council buttons
    contentEl.querySelectorAll(".join-council-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const ppKey = (btn as HTMLElement).dataset.ppKey!;
        const pp = knownPps.find((p) => p.publicKey === ppKey);
        openJoinCouncilModal(ppKey, pp?.derivationIndex ?? 0, loadAndRender);
      });
    });

    // Wire delete buttons
    contentEl.querySelectorAll(".delete-pp-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ppKey = (btn as HTMLElement).dataset.ppKey!;
        if (!confirm("Delete this provider? This cannot be undone.")) return;
        try {
          await deletePp(ppKey);
          localStorage.removeItem(`pp_meta_${ppKey}`);
          await loadAndRender();
        } catch (err) {
          alert(err instanceof Error ? err.message : "Failed to delete");
        }
      });
    });

    // Wire PP row clicks
    contentEl.querySelectorAll("[data-pp]").forEach((row) => {
      row.addEventListener("click", () => {
        const pk = (row as HTMLElement).dataset.pp!;
        sessionStorage.setItem("selected_pp", pk);
        navigate("/pp");
      });
    });
  }

  loadAndRender();
  return el;
}


function openCreatePpModal(existingPps: PpInfo[], onCreated: () => Promise<void>) {
  document.querySelector("#create-pp-modal")?.remove();

  const selectedJurisdictions = new Set<string>();

  const overlay = document.createElement("div");
  overlay.id = "create-pp-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>New Provider</h3>
        <button class="modal-close" id="modal-close-btn">&times;</button>
      </div>
      <div class="form-group">
        <label for="pp-name">Provider name</label>
        <input type="text" id="pp-name" placeholder="Acme Privacy Inc" />
      </div>
      <div class="form-group">
        <label for="pp-email">Contact email</label>
        <input type="email" id="pp-email" placeholder="admin@acme.com" />
      </div>
      <div class="form-group">
        <label>Jurisdictions</label>
        <div id="pp-jurisdiction-tags" class="jurisdiction-tags"></div>
        <div class="jurisdiction-picker">
          <input type="text" id="pp-jurisdiction-filter" placeholder="Search countries..."
            style="border:none;border-bottom:1px solid var(--border);border-radius:0;position:sticky;top:0;background:var(--bg);z-index:1" />
          <div id="pp-jurisdiction-list" class="jurisdiction-list"></div>
        </div>
      </div>
      <button id="modal-create-btn" class="btn-primary btn-wide" style="margin-top:0.5rem">Create Provider</button>
      <p id="modal-error" class="error-text" style="margin-top:0.75rem" hidden></p>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector("#modal-close-btn") as HTMLButtonElement;
  const createBtn = overlay.querySelector("#modal-create-btn") as HTMLButtonElement;
  const errorEl = overlay.querySelector("#modal-error") as HTMLParagraphElement;
  const nameInput = overlay.querySelector("#pp-name") as HTMLInputElement;
  const tagsEl = overlay.querySelector("#pp-jurisdiction-tags") as HTMLDivElement;
  const filterEl = overlay.querySelector("#pp-jurisdiction-filter") as HTMLInputElement;
  const listEl = overlay.querySelector("#pp-jurisdiction-list") as HTMLDivElement;

  function renderTags() {
    tagsEl.innerHTML = "";
    for (const code of selectedJurisdictions) {
      const entry = COUNTRY_CODES.find((c) => c.code === code);
      if (!entry) continue;
      const tag = document.createElement("span");
      tag.className = "jurisdiction-tag";
      tag.textContent = `${entry.code} `;
      const x = document.createElement("button");
      x.textContent = "\u00d7";
      x.style.cssText = "background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0 0 0 0.25rem;font-size:1rem";
      x.addEventListener("click", () => {
        selectedJurisdictions.delete(code);
        renderTags();
        renderList(filterEl.value);
      });
      tag.appendChild(x);
      tagsEl.appendChild(tag);
    }
  }

  function renderList(filter: string) {
    listEl.innerHTML = "";
    const q = filter.toLowerCase();
    if (q.length < 2) {
      const hint = document.createElement("p");
      hint.style.cssText = "color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0.75rem";
      hint.textContent = "Type at least 2 characters to search...";
      listEl.appendChild(hint);
      return;
    }
    for (const country of COUNTRY_CODES) {
      if (!country.label.toLowerCase().includes(q) && !country.code.toLowerCase().includes(q)) continue;
      const selected = selectedJurisdictions.has(country.code);
      const option = document.createElement("div");
      option.className = "jurisdiction-option" + (selected ? " selected" : "");
      const flag = country.code.toUpperCase().replace(/./g, (c: string) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
      option.textContent = `${flag} ${country.label}`;
      option.addEventListener("click", () => {
        if (selected) selectedJurisdictions.delete(country.code);
        else selectedJurisdictions.add(country.code);
        renderTags();
        if (!selected) { filterEl.value = ""; renderList(""); }
        else renderList(filterEl.value);
      });
      listEl.appendChild(option);
    }
  }

  filterEl.addEventListener("input", () => renderList(filterEl.value));
  renderList("");

  function close() { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  function onEsc(e: KeyboardEvent) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onEsc);

  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  nameInput.focus();

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const email = (overlay.querySelector("#pp-email") as HTMLInputElement).value.trim();
    const jurisdictions = Array.from(selectedJurisdictions);

    if (!name) {
      errorEl.textContent = "Provider name is required";
      errorEl.hidden = false;
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating privacy provider...";
    errorEl.hidden = true;

    try {
      // Scan indices to find the first unused one.
      // An index is "used" if the derived address has ever existed on-chain
      // (funded at any point) OR is in the current PP list.
      const { accountExists } = await import("../lib/horizon.ts");
      const existingKeys = new Set(existingPps.map((p) => p.publicKey));
      const MAX_SCAN = 20;
      let index = -1;
      let derived: { publicKey: string; secretKey: string } | null = null;

      for (let i = 0; i < MAX_SCAN; i++) {
        const kp = await derivePpKeypair(i);
        if (existingKeys.has(kp.publicKey)) continue;
        if (await accountExists(kp.publicKey)) continue;
        index = i;
        derived = kp;
        break;
      }

      if (index === -1 || !derived) {
        throw new Error("Could not find an available provider slot.");
      }

      createBtn.textContent = "Creating privacy provider...";
      await registerPp(derived.secretKey, index, name);

      const publicKey = derived.publicKey;

      // Store metadata for use in join flow
      const meta: Record<string, string | string[]> = { label: name };
      if (email) meta.contactEmail = email;
      if (jurisdictions.length > 0) meta.jurisdictions = jurisdictions;
      localStorage.setItem(`pp_meta_${publicKey}`, JSON.stringify(meta));

      close();
      await onCreated();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Failed to create provider";
      errorEl.hidden = false;
      createBtn.disabled = false;
      createBtn.textContent = "Create Provider";
    }
  });
}

function openJoinCouncilModal(ppPublicKey: string, ppDerivationIndex: number, onJoined: () => Promise<void>) {
  document.querySelector("#join-council-modal")?.remove();

  const meta = JSON.parse(localStorage.getItem(`pp_meta_${ppPublicKey}`) || "{}");

  const overlay = document.createElement("div");
  overlay.id = "join-council-modal";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Join a Council</h3>
        <button class="modal-close" id="jc-close-btn">&times;</button>
      </div>
      <div id="jc-discover">
        <div class="form-group">
          <label for="jc-url">Council URL</label>
          <input type="text" id="jc-url" placeholder="https://council-platform.example.com" />
        </div>
        <button id="jc-discover-btn" class="btn-primary btn-wide">Discover</button>
        <p id="jc-error" class="error-text" style="margin-top:0.75rem" hidden></p>
      </div>
      <div id="jc-info" hidden></div>
      <div id="jc-confirm" hidden>
        <button id="jc-join-btn" class="btn-primary btn-wide">Request to Join</button>
        <p id="jc-join-error" class="error-text" style="margin-top:0.75rem" hidden></p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector("#jc-close-btn") as HTMLButtonElement;
  const urlInput = overlay.querySelector("#jc-url") as HTMLInputElement;
  const discoverBtn = overlay.querySelector("#jc-discover-btn") as HTMLButtonElement;
  const errorEl = overlay.querySelector("#jc-error") as HTMLParagraphElement;
  const infoEl = overlay.querySelector("#jc-info") as HTMLDivElement;
  const confirmEl = overlay.querySelector("#jc-confirm") as HTMLDivElement;
  let discovered: CouncilInfo | null = null;

  function close() { overlay.remove(); document.removeEventListener("keydown", onEsc); }
  function onEsc(e: KeyboardEvent) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onEsc);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  urlInput.focus();

  urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") discoverBtn.click(); });

  discoverBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) { errorEl.textContent = "Please enter a council URL"; errorEl.hidden = false; return; }

    discoverBtn.disabled = true;
    discoverBtn.textContent = "Discovering...";
    errorEl.hidden = true;
    infoEl.hidden = true;
    confirmEl.hidden = true;

    try {
      discovered = await discoverCouncil(url);

      const flags = discovered.jurisdictions.map((j) => {
        const flag = j.countryCode.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
        return `<span title="${escapeHtml(j.label || j.countryCode)}" style="font-size:1.2rem">${flag}</span>`;
      }).join(" ");
      const uniqueAssets = [...new Set(discovered.channels.map((ch) => ch.assetCode))];
      const assets = uniqueAssets.map((code) =>
        `<span class="badge badge-active" style="margin-right:0.25rem">${escapeHtml(code)}</span>`
      ).join("");

      infoEl.innerHTML = `
        <div class="stat-card" style="margin:1rem 0;padding:1rem">
          <h3 style="margin:0 0 0.5rem;color:var(--text);font-size:1rem;text-transform:none;letter-spacing:0">${escapeHtml(discovered.council.name)}</h3>
          ${discovered.council.description ? `<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.5rem">${escapeHtml(discovered.council.description)}</p>` : ""}
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.85rem">
            <div><span class="stat-label">Jurisdictions</span><div style="margin-top:0.25rem">${flags || "--"}</div></div>
            <div><span class="stat-label">Assets</span><div style="margin-top:0.25rem">${assets || "--"}</div></div>
            <div><span class="stat-label">Providers</span><div style="margin-top:0.25rem">${discovered.providers.length}</div></div>
          </div>
        </div>
      `;
      infoEl.hidden = false;
      confirmEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : "Discovery failed";
      errorEl.hidden = false;
    } finally {
      discoverBtn.disabled = false;
      discoverBtn.textContent = "Discover";
    }
  });

  const joinBtn = overlay.querySelector("#jc-join-btn") as HTMLButtonElement;
  const joinError = overlay.querySelector("#jc-join-error") as HTMLParagraphElement;

  joinBtn.addEventListener("click", async () => {
    joinBtn.disabled = true;
    joinBtn.textContent = "Submitting...";
    joinError.hidden = true;

    try {
      // Derive the PP keypair to sign the join request client-side
      const { derivePpKeypair } = await import("../lib/wallet.ts");
      const { signPayload } = await import("../lib/api.ts");
      const derived = await derivePpKeypair(ppDerivationIndex);

      const joinPayload = {
        publicKey: ppPublicKey,
        councilId: discovered!.council.channelAuthId,
        label: typeof meta.label === "string" ? meta.label : null,
        contactEmail: typeof meta.contactEmail === "string" ? meta.contactEmail : null,
        jurisdictions: Array.isArray(meta.jurisdictions) && meta.jurisdictions.length > 0
          ? meta.jurisdictions
          : null,
      };
      const signedEnvelope = await signPayload(joinPayload, derived.secretKey);

      await joinCouncil({
        councilUrl: discovered!.councilUrl,
        councilId: discovered!.council.channelAuthId,
        councilName: discovered!.council.name,
        councilPublicKey: discovered!.council.councilPublicKey,
        ppPublicKey,
        signedEnvelope,
      });

      capture("provider_join_request_submitted", { councilUrl: discovered!.councilUrl });
      close();
      await onJoined();
    } catch (err) {
      joinError.textContent = err instanceof Error ? err.message : "Failed to submit";
      joinError.hidden = false;
      joinBtn.disabled = false;
      joinBtn.textContent = "Request to Join";
    }
  });
}

export const homeView = page(renderContent);
