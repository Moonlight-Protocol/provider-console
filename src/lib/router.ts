/**
 * Minimal hash-based router for SPA navigation.
 *
 * Routes are defined as hash paths: #/login, #/channels, #/mempool, etc.
 * Each route maps to a render function that returns an HTMLElement.
 */

type RouteHandler = () => HTMLElement | Promise<HTMLElement>;

const routes = new Map<string, RouteHandler>();
let cleanups: (() => void)[] = [];

export function route(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function navigate(path: string): void {
  window.location.hash = path;
}

async function render(): Promise<void> {
  const hash = window.location.hash || "#/";
  const path = hash.startsWith("#") ? hash.slice(1) : hash;

  const handler = routes.get(path) || routes.get("/404");
  if (!handler) return;

  // Run cleanups from previous view
  for (const fn of cleanups) {
    fn();
  }
  cleanups = [];

  const app = document.getElementById("app");
  if (!app) return;

  const element = await handler();
  app.innerHTML = "";
  app.appendChild(element);

  // Reset scroll on navigation
  window.scrollTo(0, 0);
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  render();
}

/**
 * Register a cleanup function for the current view.
 * All registered cleanups run before the next route renders.
 */
export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}
