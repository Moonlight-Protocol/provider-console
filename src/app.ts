import { route, startRouter, navigate } from "./lib/router.ts";
import { initAnalytics } from "./lib/analytics.ts";
import { isAuthenticated } from "./lib/api.ts";

import { loginView } from "./views/login.ts";
import { channelsView } from "./views/channels.ts";
import { operationsView } from "./views/operations.ts";
import { mempoolView } from "./views/mempool.ts";
import { treasuryView } from "./views/treasury.ts";
import { auditView } from "./views/audit.ts";
import { analyticsView } from "./views/analytics.ts";

// Initialize analytics (NOOP in dev)
initAnalytics();

// Register routes
route("/login", loginView);
route("/channels", channelsView);
route("/operations", operationsView);
route("/mempool", mempoolView);
route("/treasury", treasuryView);
route("/audit", auditView);
route("/analytics", analyticsView);

// Default route
route("/", () => {
  if (isAuthenticated()) {
    navigate("/channels");
  } else {
    navigate("/login");
  }
  return document.createElement("div");
});

// 404
route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML = `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/channels">Back to dashboard</a></div>`;
  return el;
});

// Start
startRouter();
