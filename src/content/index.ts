import { mountSidebar } from "../sidebar/sidebar";
import { exposeFunnelRunner } from "../engine/funnelRunner";

const WPP_SCRIPT_PATH = "wppconnect-wa.js";
const PAGE_BRIDGE_PATH = "src/pageBridge/index.js";

const injectPageScript = (filePath: string, type: "module" | "text/javascript" = "module") => {
  if (document.querySelector(`script[data-zop="${filePath}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(filePath);
  script.type = type;
  script.dataset.zop = filePath;
  (document.head || document.documentElement).appendChild(script);
};

const init = () => {
  if (document.getElementById("zop-sidebar-root")) {
    return;
  }

  injectPageScript(WPP_SCRIPT_PATH, "text/javascript");
  injectPageScript(PAGE_BRIDGE_PATH, "text/javascript");
  mountSidebar();
  exposeFunnelRunner();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
