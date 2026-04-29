/**
 * Shared setup layout with progress stepper.
 */
import { isAuthenticated } from "../../lib/api.ts";
import { getConnectedAddress, isMasterSeedReady } from "../../lib/wallet.ts";
import { isAllowed } from "../../lib/config.ts";
import { navigate } from "../../lib/router.ts";
import { renderNav } from "../../components/nav.ts";
import { SETUP_STEPS, type SetupStepId } from "../../lib/setup.ts";

export function setupPage(
  currentStep: SetupStepId,
  renderStep: () => HTMLElement | Promise<HTMLElement>,
): () => Promise<HTMLElement> {
  return async () => {
    const addr = getConnectedAddress();
    if (
      !isAuthenticated() || !isMasterSeedReady() || (addr && !isAllowed(addr))
    ) {
      navigate("/login");
      return document.createElement("div");
    }

    const wrapper = document.createElement("div");
    wrapper.appendChild(renderNav());

    const main = document.createElement("main");
    main.className = "container";

    // Progress stepper
    const stepper = document.createElement("div");
    stepper.className = "onboarding-stepper";

    const currentIdx = SETUP_STEPS.findIndex((s) => s.id === currentStep);

    for (let i = 0; i < SETUP_STEPS.length; i++) {
      const step = SETUP_STEPS[i];
      const stepEl = document.createElement("div");
      stepEl.className = "onboarding-step";
      if (i < currentIdx) stepEl.classList.add("done");
      if (i === currentIdx) stepEl.classList.add("active");

      const dot = document.createElement("span");
      dot.className = "step-dot";
      dot.textContent = i < currentIdx ? "\u2713" : String(i + 1);

      const label = document.createElement("span");
      label.className = "step-label";
      label.textContent = step.label;

      stepEl.append(dot, label);
      stepper.appendChild(stepEl);

      if (i < SETUP_STEPS.length - 1) {
        const line = document.createElement("div");
        line.className = "step-line";
        if (i < currentIdx) line.classList.add("done");
        stepper.appendChild(line);
      }
    }

    main.appendChild(stepper);

    const content = document.createElement("div");
    content.className = "onboarding-content";
    const rendered = await renderStep();
    content.appendChild(rendered);
    main.appendChild(content);

    wrapper.appendChild(main);
    return wrapper;
  };
}
