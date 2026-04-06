import { renderNav } from "./nav.ts";
import { isAuthenticated, listPps, checkMembershipStatus, type PpInfo } from "../lib/api.ts";
import { isMasterSeedReady } from "../lib/wallet.ts";
import { navigate } from "../lib/router.ts";

const BANNER_ID = "membership-banner";

/**
 * Background membership check for ACTIVE PPs.
 * Detects revocations (ACTIVE → not ACTIVE) and shows a banner.
 * If a revocation banner is already showing but the PP is active again, removes it.
 */
async function checkMemberships(wrapper: HTMLElement) {
  let pps: PpInfo[];
  try {
    pps = await listPps();
  } catch {
    return;
  }

  const activePps = pps.filter((pp) => pp.councilMembership?.status === "ACTIVE");
  if (activePps.length === 0) return;

  let revoked = false;
  for (const pp of activePps) {
    try {
      const result = await checkMembershipStatus(pp.publicKey);
      if (result !== "ACTIVE") {
        showBanner(wrapper, `Your provider "${pp.label || pp.publicKey}" was removed from ${pp.councilMembership!.councilName || "the council"}.`);
        revoked = true;
        break;
      }
    } catch { /* silently fail */ }
  }

  // If no revocations found but a banner is showing, the PP was re-accepted — remove it
  if (!revoked) {
    document.getElementById(BANNER_ID)?.remove();
  }
}

function showBanner(wrapper: HTMLElement, message: string) {
  document.getElementById(BANNER_ID)?.remove();

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.className = "membership-banner revoked";
  banner.textContent = message;

  // Insert after nav, before main
  const nav = wrapper.querySelector("nav");
  if (nav?.nextSibling) {
    wrapper.insertBefore(banner, nav.nextSibling);
  } else {
    wrapper.prepend(banner);
  }
}

/**
 * Wraps a view with the nav bar and auth check.
 */
export function page(renderContent: () => HTMLElement | Promise<HTMLElement>): () => Promise<HTMLElement> {
  return async () => {
    if (!isAuthenticated() || !isMasterSeedReady()) {
      navigate("/login");
      return document.createElement("div");
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav());

    const main = document.createElement("main");
    main.className = "container";
    const content = await renderContent();
    main.appendChild(content);
    wrapper.appendChild(main);

    // Non-blocking background membership check
    checkMemberships(wrapper);

    return wrapper;
  };
}
