import { route, startRouter, navigate } from "./lib/router.ts";
import { initAnalytics } from "./lib/analytics.ts";
import { isAuthenticated } from "./lib/api.ts";

import { loginView } from "./views/login.ts";
import { homeView } from "./views/home.ts";
import { fundView } from "./views/setup/fund.ts";
import { joinView } from "./views/setup/join.ts";
import { dashboardView } from "./views/dashboard.ts";

// Initialize analytics (NOOP in dev)
initAnalytics();

// Register routes
route("/login", loginView);
route("/setup/fund", fundView);
route("/setup/join", joinView);
route("/dashboard", dashboardView);
route("/home", homeView);

// Root — redirect based on auth state
route("/", () => {
  if (isAuthenticated()) {
    navigate("/home");
  } else {
    navigate("/login");
  }
  return document.createElement("div");
});

// 404
route("/404", () => {
  const el = document.createElement("div");
  el.className = "login-container";
  el.innerHTML = `<div class="login-card"><h1>404</h1><p>Page not found.</p><a href="#/">Back to home</a></div>`;
  return el;
});

// Start
startRouter();

// Dev-mode version check — __DEV_MODE__ is false in production, esbuild removes the block
import { checkVersions } from "./lib/version-check.ts";
declare const __DEV_MODE__: boolean;
if (__DEV_MODE__) {
  checkVersions().then((banner) => {
    if (banner) document.body.prepend(banner);
  });
}
