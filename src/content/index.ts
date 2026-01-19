import { mountSidebar } from "../sidebar/sidebar";
import { exposeFunnelRunner } from "../engine/funnelRunner";

const WPP_SCRIPT_PATH = "wppconnect-wa.js";
const PAGE_BRIDGE_PATH = "src/pageBridge/index.js";
const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";
const PIX_BUTTON_ID = "zop-pix-inline";
const PIX_BACKDROP_ID = "zop-pix-backdrop";
const PIX_MODAL_ID = "zop-pix-modal";
const PIX_NAME_KEY = "pix_nome_padrao";
const PIX_MODE_KEY = "pix_tipo_padrao";
const PIX_MODES = [
  { value: "CPF", label: "CPF" },
  { value: "CNPJ", label: "CNPJ" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "EVP", label: "Chave aleatória" }
] as const;

type PageBridgeResponse<T> = {
  id: string;
  payload?: T;
};

const createRequestId = () => `zop-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ActiveChat = {
  id: string;
  name?: string;
};

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

const requestActiveChat = () => requestPageBridge<ActiveChat | null>({ type: "active-chat" }, 5000);

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

const getStoredPixPreferences = (): Promise<{ name?: string; mode?: string }> =>
  new Promise((resolve) => {
    const fallback = {
      name: typeof localStorage !== "undefined" ? localStorage.getItem(PIX_NAME_KEY) ?? undefined : undefined,
      mode: typeof localStorage !== "undefined" ? localStorage.getItem(PIX_MODE_KEY) ?? undefined : undefined
    };

    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get([PIX_NAME_KEY, PIX_MODE_KEY], (items) => {
        resolve({
          name: typeof items?.[PIX_NAME_KEY] === "string" ? items[PIX_NAME_KEY] : fallback.name,
          mode: typeof items?.[PIX_MODE_KEY] === "string" ? items[PIX_MODE_KEY] : fallback.mode
        });
      });
      return;
    }

    resolve(fallback);
  });

const setStoredPixPreferences = (updates: { name?: string; mode?: string }) => {
  try {
    const payload: Record<string, string> = {};
    if (typeof updates.name === "string") {
      payload[PIX_NAME_KEY] = updates.name;
    }
    if (typeof updates.mode === "string") {
      payload[PIX_MODE_KEY] = updates.mode;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.set(payload);
      return;
    }

    if (typeof payload[PIX_NAME_KEY] === "string") {
      localStorage.setItem(PIX_NAME_KEY, payload[PIX_NAME_KEY]);
    }
    if (typeof payload[PIX_MODE_KEY] === "string") {
      localStorage.setItem(PIX_MODE_KEY, payload[PIX_MODE_KEY]);
    }
  } catch (error) {
    console.warn("[ZOP][PIX] storage error", error);
  }
};

const ensurePixStyles = () => {
  if (document.getElementById("zop-pix-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "zop-pix-style";
  style.textContent = `
    #${PIX_BUTTON_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      border: 1px solid rgba(88, 101, 242, 0.4);
      background: #141418;
      color: #fff;
      font-size: 20px;
      margin-right: 6px;
      cursor: pointer;
      transition: transform 0.08s ease, box-shadow 0.2s ease;
    }
    #${PIX_BUTTON_ID}:hover {
      transform: translateY(-1px);
      box-shadow: inset 0 0 0 2px rgba(88, 101, 242, 0.6);
    }
    .zop-pix-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483000;
    }
    .zop-pix-modal {
      width: min(520px, 90vw);
      background: #16161b;
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 24px 55px rgba(0, 0, 0, 0.65);
      border: 1px solid rgba(88, 101, 242, 0.3);
      color: #fff;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .zop-pix-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .zop-pix-label {
      font-size: 11px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.6);
    }
    .zop-pix-input,
    .zop-pix-textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(88, 101, 242, 0.4);
      background: rgba(8, 8, 10, 0.9);
      color: #fff;
      padding: 10px 12px;
      font-size: 14px;
      resize: none;
    }
    .zop-pix-input:focus,
    .zop-pix-textarea:focus {
      outline: none;
      border-color: rgba(88, 101, 242, 0.9);
      box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2);
    }
    .zop-pix-error {
      font-size: 12px;
      color: #ff6b6b;
      margin: 0;
    }
    .zop-pix-radio-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .zop-pix-radio {
      font-size: 13px;
      cursor: pointer;
      border-radius: 999px;
      border: 1px solid rgba(88, 101, 242, 0.4);
      padding: 6px 14px;
      background: rgba(255, 255, 255, 0.05);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: #fff;
    }
    .zop-pix-radio input {
      display: none;
    }
    .zop-pix-radio span {
      display: inline-flex;
      align-items: center;
    }
    .zop-pix-radio input:checked + span {
      background: rgba(88, 101, 242, 0.85);
      border-radius: 999px;
      padding: 2px 10px;
    }
    .zop-pix-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 8px;
    }
    .zop-pix-btn {
      border-radius: 999px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
    }
    .zop-pix-btn--ghost {
      background: transparent;
      border: 1px solid rgba(88, 101, 242, 0.6);
      color: #fff;
    }
    .zop-pix-btn--primary {
      background: linear-gradient(135deg, rgba(0, 248, 136, 0.7), rgba(0, 192, 255, 0.8));
      color: #041003;
      box-shadow: 0 10px 24px rgba(0, 192, 255, 0.4);
    }
  `;
  document.head?.appendChild(style);
};

const sendPixMessage = async (chatId: string, mode: string, name: string, key: string) => {
  console.log("[ZOP][PIX] send request");
  const response = await requestPageBridge<{ ok?: boolean; error?: string }>(
    { type: "send-pix", chatId, keyType: mode, key, name, instructions: "" },
    12000
  );
  if (response?.ok) {
    console.log("[ZOP][PIX] sent ok");
    return true;
  }
  console.error("[ZOP][PIX] sent error", response?.error);
  return false;
};

const openPixModal = async () => {
  console.log("[ZOP][PIX] opening modal");
  if (document.getElementById(PIX_BACKDROP_ID)) {
    return;
  }
  ensurePixStyles();
  const backdrop = document.createElement("div");
  backdrop.id = PIX_BACKDROP_ID;
  backdrop.className = "zop-pix-backdrop";
  const modal = document.createElement("div");
  modal.id = PIX_MODAL_ID;
  modal.className = "zop-pix-modal";
  modal.innerHTML = `
    <h3 style="margin:0;font-size:20px">Enviar PIX</h3>

    <div class="zop-pix-field">
      <span class="zop-pix-label">Tipo</span>
      <div class="zop-pix-radio-group">
        ${PIX_MODES.map(
          (option, index) => `
            <label class="zop-pix-radio">
              <input type="radio" name="zop-pix-mode" value="${option.value}" ${index === 0 ? "checked" : ""} />
              <span>${option.label}</span>
            </label>
          `
        ).join("")}
      </div>
    </div>

    <div class="zop-pix-field">
      <label class="zop-pix-label" for="zop-pix-name">Nome</label>
      <input id="zop-pix-name" class="zop-pix-input" type="text" placeholder="Ex.: ZapOrganic Pro" />
      <p id="zop-pix-name-error" class="zop-pix-error" style="display:none">Informe o nome.</p>
    </div>

    <div class="zop-pix-field">
      <label class="zop-pix-label" for="zop-pix-key">Chave</label>
      <textarea id="zop-pix-key" class="zop-pix-textarea" rows="4" placeholder="Cole aqui..."></textarea>
    </div>

    <div class="zop-pix-footer">
      <button class="zop-pix-btn zop-pix-btn--ghost" type="button" id="zop-pix-cancel">Cancelar</button>
      <button class="zop-pix-btn zop-pix-btn--primary" type="button" id="zop-pix-send">Enviar</button>
    </div>
  `;

  backdrop.appendChild(modal);
  (document.body || document.documentElement)?.appendChild(backdrop);
  document.documentElement.classList.add("zo-modal-open");
  document.body.classList.add("zo-modal-open");

  const nameInput = modal.querySelector<HTMLInputElement>("#zop-pix-name");
  const keyInput = modal.querySelector<HTMLTextAreaElement>("#zop-pix-key");
  const sendButton = modal.querySelector<HTMLButtonElement>("#zop-pix-send");
  const cancelButton = modal.querySelector<HTMLButtonElement>("#zop-pix-cancel");
  const errorEl = modal.querySelector<HTMLElement>("#zop-pix-name-error");
  const modeRadios = Array.from(modal.querySelectorAll<HTMLInputElement>('input[name="zop-pix-mode"]'));

  const closeModal = () => {
    backdrop.remove();
    document.documentElement.classList.remove("zo-modal-open");
    document.body.classList.remove("zo-modal-open");
    document.removeEventListener("keydown", handleKeydown);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
    }
  };

  document.addEventListener("keydown", handleKeydown);

  const setError = (message: string) => {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = message ? "block" : "none";
    }
  };

  const persistName = () => {
    setStoredPixPreferences({
      name: nameInput?.value.trim() || undefined
    });
  };

  const persistMode = (value: string) => {
    setStoredPixPreferences({
      mode: value
    });
  };

  nameInput?.addEventListener("input", () => {
    setError("");
    persistName();
  });
  nameInput?.addEventListener("blur", () => persistName());
  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        persistMode(radio.value);
      }
    });
  });

  cancelButton?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  try {
    const stored = await getStoredPixPreferences();
    if (stored.name && nameInput) {
      nameInput.value = stored.name;
    }
    if (stored.mode) {
      const radio = modeRadios.find((radioItem) => radioItem.value === stored.mode);
      if (radio) {
        radio.checked = true;
      }
    }
  } catch (error) {
    console.warn("[ZOP][PIX] preferences load failure", error);
  }

  sendButton?.addEventListener("click", async () => {
    const selectedMode = modeRadios.find((radio) => radio.checked);
    const mode = selectedMode?.value || PIX_MODES[0].value;
    const name = nameInput?.value.trim() || "";
    const key = keyInput?.value.trim() || "";
    setError("");

    if (!name) {
      setError("Informe o nome.");
      nameInput?.focus();
      return;
    }
    if (!key) {
      keyInput?.focus();
      return;
    }

    persistName();
    persistMode(mode);

    try {
      const chat = await requestActiveChat();
      if (!chat?.id) {
        setError("Abra um chat para enviar o PIX.");
        return;
      }
      const ok = await sendPixMessage(chat.id, mode, name, key);
      if (ok) {
        closeModal();
      } else {
        setError("Falha ao enviar PIX.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Falha ao enviar PIX.";
      setError(message);
    }
  });
};

let composerObserver: MutationObserver | null = null;

const mountPixComposerButton = () => {
  ensurePixStyles();
  const attachButton = document.querySelector<HTMLButtonElement>("button[data-icon='clip']");
  if (!attachButton) {
    return;
  }
  const host = attachButton.parentElement;
  if (!host) {
    return;
  }
  if (host.querySelector(`#${PIX_BUTTON_ID}`)) {
    return;
  }
  const button = document.createElement("button");
  button.id = PIX_BUTTON_ID;
  button.type = "button";
  button.title = "Enviar PIX";
  button.textContent = "🤑";
  button.className = "zop-pix-inline-button";
  button.addEventListener("click", () => {
    console.log("[ZOP][PIX] mount button ok");
    void openPixModal();
  });
  host.insertBefore(button, attachButton);
};

const startComposerObserver = () => {
  if (composerObserver) {
    return;
  }
  composerObserver = new MutationObserver(() => {
    mountPixComposerButton();
  });
  composerObserver.observe(document.body, { childList: true, subtree: true });
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

const startExtension = () => {
  init();
  mountPixComposerButton();
  startComposerObserver();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startExtension, { once: true });
} else {
  startExtension();
}
