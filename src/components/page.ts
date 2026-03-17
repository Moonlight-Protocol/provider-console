import { renderNav } from "./nav.ts";
import { isAuthenticated } from "../lib/api.ts";
import { navigate } from "../lib/router.ts";

/**
 * Wraps a view with the nav bar and auth check.
 */
export function page(renderContent: () => HTMLElement | Promise<HTMLElement>): () => Promise<HTMLElement> {
  return async () => {
    if (!isAuthenticated()) {
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

    return wrapper;
  };
}
