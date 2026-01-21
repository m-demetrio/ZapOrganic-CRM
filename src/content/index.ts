import { mountSidebar } from "../sidebar/sidebar";
import { exposeFunnelRunner } from "../engine/funnelRunner";
import { loadData } from "../shared/storage";
import type { Funnel, IntegrationSettings, LeadCard, QuickReply } from "../shared/schema";

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
const PIX_GROUP_ERROR_MESSAGE = "PIX disponível apenas em chats individuais.";

const PIX_COMPOSER_HOST_SELECTORS = [
  "#main > footer ._ak1r > div",
  "#main > footer > div > div",
  "[data-testid='conversation-compose-box']"
] as const;

const CHAT_BAR_ID = "zop-chat-bar";
const CHAT_BAR_STYLE_ID = "zop-chat-bar-style";
const CHAT_BAR_TYPE_BUTTON_ID = "zop-chat-bar-type-button";
const CHAT_BAR_TYPE_MENU_ID = "zop-chat-bar-type-menu";
const CHAT_BAR_TYPES = ["Textos", "Áudios", "Imagens", "Vídeos", "Funil", "Outros"] as const;
const FUNNEL_STORAGE_KEY = "zopFunnels";
const QUICK_REPLY_STORAGE_KEY = "zopQuickReplies";
const SETTINGS_STORAGE_KEY = "zopIntegrationSettings";
const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  enableWebhook: false,
  defaultDelaySec: 0
};

const [
  CHAT_BAR_TYPE_TEXT,
  CHAT_BAR_TYPE_AUDIO,
  CHAT_BAR_TYPE_IMAGE,
  CHAT_BAR_TYPE_VIDEO,
  CHAT_BAR_TYPE_FUNNEL,
  CHAT_BAR_TYPE_OTHER
] = CHAT_BAR_TYPES;
type ChatBarType = (typeof CHAT_BAR_TYPES)[number];

type PageBridgeResponse<T> = {
  id: string;
  payload?: T;
};

const createRequestId = () => `zop-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type ActiveChat = {
  id: string;
  name?: string;
  isGroup?: boolean;
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

const locateComposerHost = (): HTMLElement | null => {
  for (const selector of PIX_COMPOSER_HOST_SELECTORS) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
  }

  const clipElement = document.querySelector<HTMLElement>("[data-icon='clip']");
  return clipElement?.parentElement ?? null;
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
    #${PIX_BACKDROP_ID} {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2147483000;
    }
    #${PIX_MODAL_ID} {
      width: min(520px, 90vw);
      background: #16161b;
      border-radius: 20px;
      padding: 32px 34px 28px;
      box-sizing: border-box;
      box-shadow: 0 24px 55px rgba(0, 0, 0, 0.65);
      border: 1px solid rgba(88, 101, 242, 0.3);
      color: #fff;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    #${PIX_MODAL_ID} .zop-pix-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
      box-sizing: border-box;
    }
    #${PIX_MODAL_ID} .zop-pix-label {
      font-size: 11px;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.6);
    }
    #${PIX_MODAL_ID} .zop-pix-input,
    #${PIX_MODAL_ID} .zop-pix-textarea {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(88, 101, 242, 0.4);
      background: rgba(8, 8, 10, 0.9);
      color: #fff;
      padding: 10px 12px;
      font-size: 14px;
      resize: none;
      box-sizing: border-box;
    }
    #${PIX_MODAL_ID} .zop-pix-input:focus,
    #${PIX_MODAL_ID} .zop-pix-textarea:focus {
      outline: none;
      border-color: rgba(88, 101, 242, 0.9);
      box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2);
    }
    #${PIX_MODAL_ID} .zop-pix-error {
      font-size: 12px;
      color: #ff6b6b;
      margin: 0;
    }
    #${PIX_MODAL_ID} .zop-pix-radio-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #${PIX_MODAL_ID} .zop-pix-radio {
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
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    #${PIX_MODAL_ID} .zop-pix-radio input {
      display: none;
    }
    #${PIX_MODAL_ID} .zop-pix-radio span {
      display: inline-flex;
      align-items: center;
    }
    #${PIX_MODAL_ID} .zop-pix-radio input:checked + span {
      border-color: rgba(88, 101, 242, 0.6);
      box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.2) inset;
    }
    #${PIX_MODAL_ID} .zop-pix-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 6px;
    }
    #${PIX_MODAL_ID} .zop-pix-btn {
      border-radius: 999px;
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
    }
    #${PIX_MODAL_ID} .zop-pix-btn--ghost {
      background: transparent;
      border: 1px solid rgba(88, 101, 242, 0.6);
      color: #fff;
    }
    #${PIX_MODAL_ID} .zop-pix-btn--primary {
      background: linear-gradient(135deg, rgba(0, 248, 136, 0.7), rgba(0, 192, 255, 0.8));
      color: #041003;
      box-shadow: 0 10px 24px rgba(0, 192, 255, 0.4);
    }
  `;
  document.head?.appendChild(style);
};

let chatBarFunnels: Funnel[] = [];
let chatBarQuickReplies: QuickReply[] = [];
let chatBarIntegrationSettings: IntegrationSettings = DEFAULT_INTEGRATION_SETTINGS;
let chatBarSearchQuery = "";
let chatBarSelectedType: ChatBarType = CHAT_BAR_TYPE_FUNNEL;
let chatBarListElement: HTMLElement | null = null;
let chatBarStorageListenerBound = false;

type FunnelRunner = {
  runFunnel: (input: {
    funnel: Funnel;
    chatId: string;
    lead: LeadCard;
    integrationSettings: IntegrationSettings;
  }) => string | null;
};

const CHAT_BAR_CARD_ICON = `
  <svg viewBox="0 0 24 24" role="presentation" focusable="false">
    <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" />
    <path d="M8 9h6M8 13h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
`;

const getFunnelRunner = (): FunnelRunner | null => {
  const target = window as Window &
    typeof globalThis & {
      zopFunnelRunner?: FunnelRunner;
    };

  return target.zopFunnelRunner ?? null;
};

function createLeadFromChat(chat: ActiveChat): LeadCard {
  return {
    id: chat.id,
    chatId: chat.id,
    title: chat.name || chat.id,
    laneId: "novo",
    tags: [],
    lastUpdateAt: Date.now()
  };
}

function openOptionsPage() {
  try {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
  } catch {
    // fallback to manual URL if the API is unavailable
  }

  const fallbackUrl = chrome?.runtime?.getURL?.("options/options.html");
  if (fallbackUrl) {
    window.open(fallbackUrl, "_blank");
  }
}

async function runFunnelForActiveChat(funnel: Funnel) {
  const chat = await requestActiveChat();
  if (!chat) {
    console.warn("[ZOP][CHAT BAR] nenhum chat ativo");
    return;
  }

  const runner = getFunnelRunner();
  if (!runner) {
    console.warn("[ZOP][CHAT BAR] runner indisponível");
    return;
  }

  const lead = createLeadFromChat(chat);
  const runId = runner.runFunnel({
    funnel,
    chatId: chat.id,
    lead,
    integrationSettings: chatBarIntegrationSettings
  });

  if (!runId) {
    console.warn("[ZOP][CHAT BAR] funnel já em andamento para este chat");
    return;
  }

  window.dispatchEvent(
    new CustomEvent("zop:chat-bar-run", {
      detail: {
        runId,
        funnelId: funnel.id,
        funnelName: funnel.name,
        chatId: chat.id,
        chatName: chat.name,
        totalSteps: Array.isArray(funnel.steps) ? funnel.steps.length : 0
      }
    })
  );
}

async function insertQuickReply(reply: QuickReply) {
  const chat = await requestActiveChat();
  if (!chat) {
    console.warn("[ZOP][CHAT BAR] nenhum chat ativo");
    return;
  }

  await requestPageBridge({
    type: "insert-text",
    chatId: chat.id,
    text: reply.message
  });
}

async function sendQuickReply(reply: QuickReply) {
  const chat = await requestActiveChat();
  if (!chat) {
    console.warn("[ZOP][CHAT BAR] nenhum chat ativo");
    return;
  }

  await requestPageBridge({
    type: "send-text",
    chatId: chat.id,
    text: reply.message
  });
}

function getQuickReplyCategory(reply: QuickReply): ChatBarType {
  switch (reply.mediaType) {
    case "audio":
    case "ptt":
      return CHAT_BAR_TYPE_AUDIO;
    case "image":
      return CHAT_BAR_TYPE_IMAGE;
    case "video":
    case "ptv":
      return CHAT_BAR_TYPE_VIDEO;
    case "file":
      return CHAT_BAR_TYPE_OTHER;
    case "text":
    default:
      return CHAT_BAR_TYPE_TEXT;
  }
}

function formatQuickReplyTypeLabel(type?: QuickReply["mediaType"]) {
  switch (type) {
    case "audio":
      return "Áudio";
    case "ptt":
      return "PTT";
    case "ptv":
      return "PTV";
    case "image":
      return "Imagem";
    case "video":
      return "Vídeo";
    case "file":
      return "Arquivo";
    default:
      return "Texto";
  }
}

function formatQuickReplyPreview(reply: QuickReply) {
  const parts: string[] = [];
  const normalized = reply.message?.trim().replace(/\s+/g, " ");
  if (normalized) {
    const capped = normalized.length > 60 ? `${normalized.slice(0, 57).trim()}...` : normalized;
    parts.push(capped);
  }
  if (reply.fileName) {
    parts.push(reply.fileName);
  }
  if (reply.businessTags && reply.businessTags.length > 0) {
    parts.push(`Etiquetas: ${reply.businessTags.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" • ") : formatQuickReplyTypeLabel(reply.mediaType);
}

function matchesFunnel(funnel: Funnel, query: string) {
  if (!query) {
    return true;
  }
  const steps = Array.isArray(funnel.steps) ? funnel.steps : [];
  const haystack = [funnel.name ?? "", funnel.description ?? "", ...steps.map((step) => `${step.type} ${step.text ?? ""}`)]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function matchesQuickReply(reply: QuickReply, query: string) {
  if (!query) {
    return true;
  }
  const haystack = [
    reply.title ?? "",
    reply.message ?? "",
    reply.categoryId ?? "",
    formatQuickReplyTypeLabel(reply.mediaType),
    (reply.businessTags ?? []).join(" ")
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function renderChatBarList() {
  const list = chatBarListElement;
  if (!list) {
    return;
  }

  const normalizedQuery = chatBarSearchQuery.trim().toLowerCase();
  const isFunnelView = chatBarSelectedType === CHAT_BAR_TYPE_FUNNEL;
  const matchedItems = (isFunnelView ? chatBarFunnels : chatBarQuickReplies)
    .filter((item) => {
      if (isFunnelView) {
        return matchesFunnel(item as Funnel, normalizedQuery);
      }
      const reply = item as QuickReply;
      return getQuickReplyCategory(reply) === chatBarSelectedType && matchesQuickReply(reply, normalizedQuery);
    })
    .map((item) => ({
      type: isFunnelView ? ("funnel" as const) : ("quickReply" as const),
      data: item
    }));

  list.innerHTML = "";

  if (matchedItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "zop-chat-card-empty";
    empty.textContent = isFunnelView ? "Nenhum funil encontrado" : "Nenhuma resposta encontrada";
    list.appendChild(empty);
    return;
  }

  matchedItems.forEach((item) => {
    const card = document.createElement("article");
    card.className = "zop-chat-card";
    card.setAttribute("role", "group");

    const icon = document.createElement("div");
    icon.className = "zop-chat-card__icon";
    icon.innerHTML = CHAT_BAR_CARD_ICON;

    const content = document.createElement("div");
    content.className = "zop-chat-card__content";

    const titleEl = document.createElement("div");
    titleEl.className = "zop-chat-card__title";

    const subtitleEl = document.createElement("div");
    subtitleEl.className = "zop-chat-card__subtitle";

    const metaEl = document.createElement("div");
    metaEl.className = "zop-chat-card__meta";

    const actions = document.createElement("div");
    actions.className = "zop-chat-card__actions";

    const ghostButton = document.createElement("button");
    ghostButton.className = "zop-chat-card__btn zop-chat-card__btn--ghost";
    ghostButton.type = "button";

    const primaryButton = document.createElement("button");
    primaryButton.className = "zop-chat-card__btn";
    primaryButton.type = "button";

    if (item.type === "funnel") {
      const { name, description, steps } = item.data as Funnel;
      titleEl.textContent = name || "Funil sem nome";
      subtitleEl.textContent = description || "Funil";
      metaEl.textContent = `${Array.isArray(steps) ? steps.length : 0} etapas`;
      ghostButton.textContent = "Visualizar";
      ghostButton.addEventListener("click", openOptionsPage);
      primaryButton.textContent = "Executar funil";
      primaryButton.addEventListener("click", () => void runFunnelForActiveChat(item.data as Funnel));
      card.setAttribute("aria-label", `Funil ${name || "sem nome"}`);
    } else {
      const quickReply = item.data as QuickReply;
      titleEl.textContent = quickReply.title || "Resposta rápida";
      subtitleEl.textContent = quickReply.categoryId || formatQuickReplyTypeLabel(quickReply.mediaType);
      metaEl.textContent = formatQuickReplyPreview(quickReply);
      ghostButton.textContent = "Inserir";
      ghostButton.addEventListener("click", () => void insertQuickReply(quickReply));
      primaryButton.textContent = "Enviar";
      primaryButton.addEventListener("click", () => void sendQuickReply(quickReply));
      card.setAttribute("aria-label", `Resposta rápida ${quickReply.title || ""}`.trim());
    }

    content.appendChild(titleEl);
    content.appendChild(subtitleEl);
    content.appendChild(metaEl);
    actions.appendChild(ghostButton);
    actions.appendChild(primaryButton);
    card.appendChild(icon);
    card.appendChild(content);
    card.appendChild(actions);
    list.appendChild(card);
  });
}

async function loadChatBarData() {
  try {
    const [storedFunnels, storedQuickReplies, storedSettings] = await Promise.all([
      loadData<Funnel[]>(FUNNEL_STORAGE_KEY, []),
      loadData<QuickReply[]>(QUICK_REPLY_STORAGE_KEY, []),
      loadData<IntegrationSettings>(SETTINGS_STORAGE_KEY, DEFAULT_INTEGRATION_SETTINGS)
    ]);
    chatBarFunnels = Array.isArray(storedFunnels) ? storedFunnels : [];
    chatBarQuickReplies = Array.isArray(storedQuickReplies) ? storedQuickReplies : [];
    chatBarIntegrationSettings = {
      ...DEFAULT_INTEGRATION_SETTINGS,
      ...(storedSettings ?? {})
    };
  } catch (error) {
    console.warn("[ZOP][CHAT BAR] falha ao carregar dados", error);
    chatBarFunnels = [];
    chatBarQuickReplies = [];
  }
  renderChatBarList();
}

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
      if (chat.isGroup) {
        setError(PIX_GROUP_ERROR_MESSAGE);
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

const mountPixComposerButton = async () => {
  ensurePixStyles();
  const existingButton = document.getElementById(PIX_BUTTON_ID);
  const activeChat = await requestActiveChat();
  if (activeChat?.isGroup) {
    existingButton?.remove();
    return;
  }

  const host = locateComposerHost();
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
  button.setAttribute("aria-label", "Enviar PIX");
  button.className = "zop-pix-inline-button";
  button.textContent = "🤑";
  button.addEventListener("click", () => {
    console.log("[ZOP][PIX] mount button ok");
    void openPixModal();
  });

  const clipElement = host.querySelector<HTMLElement>("[data-icon='clip']");
  if (clipElement && host.contains(clipElement)) {
    host.insertBefore(button, clipElement);
    return;
  }
  host.prepend(button);
};

const startComposerObserver = () => {
  if (composerObserver) {
    return;
  }
  composerObserver = new MutationObserver(() => {
    void mountPixComposerButton();
    void mountChatFunnelBar();
  });
  composerObserver.observe(document.body, { childList: true, subtree: true });
};

const ensureChatBarStyles = () => {
  if (document.getElementById(CHAT_BAR_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = CHAT_BAR_STYLE_ID;
  style.textContent = `
    #${CHAT_BAR_ID} {
      --zop-chat-purple-main: #9e57f8;
      --zop-chat-purple-mid: #9050f0;
      --zop-chat-purple-dark: #402080;
      --zop-chat-border: rgba(158, 87, 248, 0.45);
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 10px 14px;
      background: rgba(8, 8, 18, 0.92);
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 16px 40px rgba(5, 2, 20, 0.75);
      backdrop-filter: blur(14px);
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f2eaff;
      position: relative;
      overflow: visible;
    }
    #${CHAT_BAR_ID}::before,
    #${CHAT_BAR_ID}::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 18px;
      pointer-events: none;
    }
    #${CHAT_BAR_ID}::before {
      border: 1px solid rgba(158, 87, 248, 0.25);
      z-index: -1;
    }
    #${CHAT_BAR_ID}::after {
      inset: 1px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      z-index: -2;
    }
    #${CHAT_BAR_ID} * {
      box-sizing: border-box;
    }
    .zop-chat-bar__row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(90px, auto);
      gap: 10px;
      align-items: center;
    }
    .zop-chat-bar__field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .zop-chat-bar__label {
      font-size: 10px;
      letter-spacing: 0.35em;
      text-transform: uppercase;
      color: rgba(242, 234, 255, 0.7);
      font-weight: 600;
    }
    .zop-chat-bar__input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(158, 87, 248, 0.35);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .zop-chat-bar__input-wrap:focus-within {
      border-color: rgba(158, 87, 248, 0.7);
      box-shadow: 0 0 0 2px rgba(158, 87, 248, 0.25);
    }
    .zop-chat-bar__input-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      color: #c490fe;
    }
    .zop-chat-bar__input-icon svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
    }
    .zop-chat-bar__input {
      flex: 1;
      padding: 4px 0;
      border: none;
      background: transparent;
      color: inherit;
      font-size: 14px;
    }
    .zop-chat-bar__input:focus {
      outline: none;
    }
    .zop-chat-bar__type-wrap {
      position: relative;
    }
    .zop-chat-bar__type {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.04);
      color: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color 0.2s ease, transform 0.18s ease;
    }
    .zop-chat-bar__type:focus-visible,
    .zop-chat-bar__type:hover {
      border-color: rgba(158, 87, 248, 0.7);
    }
    .zop-chat-bar__type-arrow {
      display: inline-flex;
      width: 18px;
      height: 18px;
      color: rgba(255, 255, 255, 0.8);
    }
    .zop-chat-bar__type-arrow svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
    }
    .zop-chat-bar__type-menu {
      position: absolute;
      left: 0;
      right: 0;
      top: auto;
      bottom: calc(100% + 8px);
      background: rgba(14, 4, 26, 0.95);
      border-radius: 14px;
      border: 1px solid rgba(158, 87, 248, 0.5);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.55);
      opacity: 0;
      pointer-events: none;
      transform: translateY(6px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      display: flex;
      flex-direction: column;
      padding: 4px 0;
      min-width: 160px;
      z-index: 2147483501;
      max-height: 260px;
      overflow-y: auto;
    }
    .zop-chat-bar__type-menu.is-open {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
    .zop-chat-bar__type-item {
      background: transparent;
      border: none;
      color: #f2eaff;
      text-align: left;
      padding: 10px 18px;
      width: 100%;
      font-weight: 500;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .zop-chat-bar__type-item:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .zop-chat-bar__clean {
      padding: 10px 16px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.06);
      color: #f2eaff;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s ease, transform 0.2s ease;
      justify-self: flex-end;
      align-self: center;
    }
    .zop-chat-bar__clean:hover {
      background: rgba(255, 255, 255, 0.12);
      transform: translateY(-1px);
    }
    .zop-chat-bar__list {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 6px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.45) transparent;
    }
    .zop-chat-bar__list::-webkit-scrollbar {
      height: 4px;
    }
    .zop-chat-bar__list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.35);
      border-radius: 999px;
    }
    .zop-chat-card {
      flex: 0 0 auto;
      min-width: 200px;
      border-radius: 18px;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(158, 87, 248, 0.45);
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
    }
    .zop-chat-card-empty {
      flex: 1;
      min-width: 260px;
      border-radius: 18px;
      padding: 18px;
      border: 1px dashed rgba(255, 255, 255, 0.45);
      background: rgba(255, 255, 255, 0.02);
      color: rgba(255, 255, 255, 0.75);
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .zop-chat-card__icon {
      width: 52px;
      height: 52px;
      border-radius: 16px;
      background: rgba(158, 87, 248, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #c490fe;
    }
    .zop-chat-card__icon svg {
      width: 24px;
      height: 24px;
      stroke: currentColor;
      fill: none;
    }
    .zop-chat-card__content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .zop-chat-card__title {
      font-size: 16px;
      font-weight: 700;
    }
    .zop-chat-card__subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4em;
      color: rgba(242, 234, 255, 0.6);
    }
    .zop-chat-card__meta {
      font-size: 12px;
      color: rgba(242, 234, 255, 0.8);
    }
    .zop-chat-card__actions {
      display: flex;
      gap: 6px;
    }
    .zop-chat-card__btn {
      border-radius: 999px;
      border: none;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .zop-chat-card__btn:active {
      transform: translateY(1px);
    }
    .zop-chat-card__btn--ghost {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.35);
      color: inherit;
    }
    .zop-chat-card__btn:not(.zop-chat-card__btn--ghost) {
      background: linear-gradient(135deg, rgba(158,87,248,0.95), rgba(144, 144, 255, 0.9));
      color: #09011a;
      box-shadow: 0 8px 24px rgba(158, 87, 248, 0.35);
    }
    @media (max-width: 960px) {
      .zop-chat-bar__row {
        grid-template-columns: 1fr;
      }
      .zop-chat-bar__clean {
        justify-self: flex-end;
      }
    }
    @media (max-width: 640px) {
      #${CHAT_BAR_ID} {
        padding: 12px 14px;
        border-radius: 18px;
      }
      .zop-chat-card {
        flex-direction: column;
        align-items: flex-start;
      }
      .zop-chat-card__actions {
        flex-wrap: wrap;
        width: 100%;
        justify-content: flex-end;
      }
      .zop-chat-card__btn {
        flex: 1;
        text-align: center;
      }
    }
  `;
  document.head?.appendChild(style);
};

let chatBarResizeObserver: ResizeObserver | null = null;
let chatBarResizeListenerBound = false;

const syncChatBarPosition = () => {
  const panel = document.getElementById(CHAT_BAR_ID);
  const host = locateComposerHost();
  const footer = locateChatFooter();
  if (!panel || !host || !footer) {
    return;
  }

  const hostRect = host.getBoundingClientRect();
  const footerRect = footer.getBoundingClientRect();
  const insetLeft = Math.max(0, footerRect.left - hostRect.left);
  const insetRight = Math.max(0, footerRect.right - hostRect.right);
  const availableWidth = hostRect.width - insetLeft - insetRight;
  panel.style.width = `${Math.max(0, availableWidth)}px`;
  panel.style.marginLeft = `${insetLeft}px`;
  panel.style.marginRight = `${insetRight}px`;
};

const observeChatBarComposerResize = () => {
  if (typeof ResizeObserver === "undefined") {
    return;
  }

  const host = locateComposerHost();
  if (!host) {
    return;
  }

  chatBarResizeObserver?.disconnect();
  chatBarResizeObserver = new ResizeObserver(() => {
    syncChatBarPosition();
  });
  chatBarResizeObserver.observe(host);
};

const ensureChatBarWindowListener = () => {
  if (chatBarResizeListenerBound) {
    return;
  }

  window.addEventListener("resize", syncChatBarPosition);
  chatBarResizeListenerBound = true;
};

const locateChatFooter = () => {
  const host = locateComposerHost();
  if (!host) {
    return null;
  }

  const footer = host.closest("footer");
  return footer ?? host.parentElement;
};

const createChatBarElement = () => {
  const panel = document.createElement("div");
  panel.id = CHAT_BAR_ID;
  panel.innerHTML = `
    <div class="zop-chat-bar__row">
      <div class="zop-chat-bar__field">
        <div class="zop-chat-bar__label">Buscar funil pelo título</div>
        <div class="zop-chat-bar__input-wrap">
          <span class="zop-chat-bar__input-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation" focusable="false">
              <circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.8" fill="none" />
              <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </span>
          <input
            id="zop-chat-bar-title"
            class="zop-chat-bar__input"
            type="search"
            placeholder="Buscar funil pelo título"
            autocomplete="off"
          />
        </div>
      </div>
      <div class="zop-chat-bar__field">
        <div class="zop-chat-bar__label">Buscar funil pelo tipo</div>
        <div class="zop-chat-bar__type-wrap">
          <button
            class="zop-chat-bar__type"
            type="button"
            id="${CHAT_BAR_TYPE_BUTTON_ID}"
            aria-haspopup="true"
            aria-expanded="false"
            data-selected-type="${CHAT_BAR_TYPES[4]}"
          >
            <span class="zop-chat-bar__type-label">${CHAT_BAR_TYPES[4]}</span>
            <span class="zop-chat-bar__type-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                <path d="M7 9l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" />
              </svg>
            </span>
          </button>
          <div class="zop-chat-bar__type-menu" id="${CHAT_BAR_TYPE_MENU_ID}" role="menu">
            ${CHAT_BAR_TYPES.map(
              (type) => `
                <button type="button" class="zop-chat-bar__type-item" data-type="${type}" role="menuitem">
                  ${type}
                </button>
              `
            ).join("")}
          </div>
        </div>
      </div>
      <button class="zop-chat-bar__clean" type="button">Limpar</button>
    </div>
    <div class="zop-chat-bar__list" aria-live="polite">
      <article class="zop-chat-card" role="group" aria-label="Funil de exemplo">
        <div class="zop-chat-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="presentation" focusable="false">
            <rect x="6" y="4" width="12" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" />
            <path d="M8 9h6M8 13h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <div class="zop-chat-card__content">
          <div class="zop-chat-card__title">Teste</div>
          <div class="zop-chat-card__subtitle">Funil</div>
          <div class="zop-chat-card__meta">3 mensagens</div>
        </div>
        <div class="zop-chat-card__actions">
          <button class="zop-chat-card__btn zop-chat-card__btn--ghost" type="button">Visualizar</button>
          <button class="zop-chat-card__btn" type="button">Enviar funil</button>
        </div>
      </article>
    </div>
  `;
  return panel;
};

const setupChatBarInteractions = (panel: HTMLElement) => {
  if (panel.dataset.chatBarInitialized === "true") {
    return;
  }
  panel.dataset.chatBarInitialized = "true";
  const searchInput = panel.querySelector<HTMLInputElement>("#zop-chat-bar-title");
  const typeButton = panel.querySelector<HTMLButtonElement>(`#${CHAT_BAR_TYPE_BUTTON_ID}`);
  const typeLabel = typeButton?.querySelector<HTMLElement>(".zop-chat-bar__type-label");
  const typeMenu = panel.querySelector<HTMLElement>(`#${CHAT_BAR_TYPE_MENU_ID}`);
  const cleanButton = panel.querySelector<HTMLButtonElement>(".zop-chat-bar__clean");
  const listElement = panel.querySelector<HTMLElement>(".zop-chat-bar__list");
  chatBarListElement = listElement ?? null;

  if (!typeButton || !typeMenu || !typeLabel || !listElement) {
    return;
  }

  const closeMenu = () => {
    typeMenu.classList.remove("is-open");
    typeButton.setAttribute("aria-expanded", "false");
  };

  searchInput?.addEventListener("input", (event) => {
    chatBarSearchQuery = (event.target as HTMLInputElement).value;
    renderChatBarList();
  });

  typeButton.addEventListener("click", (event) => {
    event.preventDefault();
    const isOpen = typeMenu.classList.toggle("is-open");
    typeButton.setAttribute("aria-expanded", String(isOpen));
  });

  Array.from(typeMenu.querySelectorAll<HTMLButtonElement>(".zop-chat-bar__type-item")).forEach((item) => {
    item.addEventListener("click", () => {
      const rawValue = item.dataset.type?.trim() || item.textContent?.trim() || "";
      const value = CHAT_BAR_TYPES.includes(rawValue as ChatBarType) ? (rawValue as ChatBarType) : CHAT_BAR_TYPE_FUNNEL;
      chatBarSelectedType = value;
      typeLabel.textContent = value;
      typeButton.dataset.selectedType = value;
      closeMenu();
      renderChatBarList();
    });
  });

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!typeMenu.contains(target) && !typeButton.contains(target)) {
      closeMenu();
    }
  };
  document.addEventListener("click", handleDocumentClick);

  cleanButton?.addEventListener("click", () => {
    if (searchInput) {
      searchInput.value = "";
    }
    chatBarSearchQuery = "";
    chatBarSelectedType = CHAT_BAR_TYPE_FUNNEL;
    typeLabel.textContent = CHAT_BAR_TYPE_FUNNEL;
    typeButton.dataset.selectedType = CHAT_BAR_TYPE_FUNNEL;
    renderChatBarList();
  });

  if (!chatBarStorageListenerBound && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      if (changes[FUNNEL_STORAGE_KEY] || changes[QUICK_REPLY_STORAGE_KEY] || changes[SETTINGS_STORAGE_KEY]) {
        void loadChatBarData();
      }
    });
    chatBarStorageListenerBound = true;
  }

  void loadChatBarData();
};

const mountChatFunnelBar = () => {
  ensureChatBarStyles();
  const footer = locateChatFooter();
  if (!footer) {
    return;
  }

  if (footer.querySelector(`#${CHAT_BAR_ID}`)) {
    return;
  }

  const panel = createChatBarElement();
  const composerHost = locateComposerHost();
  if (composerHost && composerHost.parentElement === footer) {
    footer.insertBefore(panel, composerHost);
  } else {
    footer.appendChild(panel);
  }
  setupChatBarInteractions(panel);
  syncChatBarPosition();
  observeChatBarComposerResize();
  ensureChatBarWindowListener();
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
  mountChatFunnelBar();
  void mountPixComposerButton();
  startComposerObserver();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startExtension, { once: true });
} else {
  startExtension();
}
