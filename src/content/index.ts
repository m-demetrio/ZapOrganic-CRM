import { mountSidebar } from "../sidebar/sidebar";
import { exposeFunnelRunner } from "../engine/funnelRunner";

const WPP_SCRIPT_PATH = "wppconnect-wa.js";
const PAGE_BRIDGE_PATH = "src/pageBridge/index.js";
const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";

type PageBridgeResponse<T> = {
  id: string;
  payload?: T;
};

const createRequestId = () => `zop-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const requestPageBridge = <T = unknown>(
  detail: Record<string, unknown>,
  timeoutMs = 15000
): Promise<T | null> => {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  const id = createRequestId();

  return new Promise<T | null>((resolve) => {
    let timeoutId = 0;
    const handler = (event: Event) => {
      const responseDetail = (event as CustomEvent<PageBridgeResponse<T>>).detail;
      if (!responseDetail || responseDetail.id !== id) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve(responseDetail.payload ?? null);
    };

    window.addEventListener(RESPONSE_EVENT, handler);
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: {
          ...detail,
          id
        }
      })
    );

    timeoutId = window.setTimeout(() => {
      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve(null);
    }, timeoutMs);
  });
};

const exposePageBridge = () => {
  const target = window as Window &
    typeof globalThis & {
      zopPageBridge?: {
        request: typeof requestPageBridge;
      };
    };

  target.zopPageBridge = {
    request: requestPageBridge
  };
};

const injectPageScript = (filePath: string, type: "text/javascript" = "text/javascript") => {
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
  exposePageBridge();
  mountSidebar();
  exposeFunnelRunner();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
