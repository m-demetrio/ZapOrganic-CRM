import sidebarHtml from "./sidebar.html?raw";
import sidebarCss from "./sidebar.css?raw";
import { resolveDelaySec } from "../shared/delay";
import { loadData } from "../shared/storage";
import type { FunnelErrorEvent, FunnelFinishedEvent, FunnelStepEvent } from "../engine/funnelRunner";
import type { Funnel, FunnelStep, IntegrationSettings, LeadCard, QuickReply } from "../shared/schema";

const HOST_ID = "zop-sidebar-root";
const TOGGLE_SHORTCUT = "KeyY";
const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";
const FUNNEL_STORAGE_KEY = "zopFunnels";
const QUICK_REPLY_STORAGE_KEY = "zopQuickReplies";
const SETTINGS_STORAGE_KEY = "zopIntegrationSettings";
const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  enableWebhook: false,
  defaultDelaySec: 0
};

type WppEventDetail = {
  status: "ready" | "timeout";
  version?: string;
};

type ActiveChat = {
  id: string;
  name?: string;
};

type PageBridgeResponse<T> = {
  id: string;
  payload?: T;
};

type SendMessageResult = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

type FunnelRunView = {
  runId: string;
  funnelId: string;
  funnelName: string;
  chatId: string;
  chatName?: string;
  totalSteps: number;
  completedSteps: number;
  currentStepIndex: number;
  currentStep?: FunnelStep;
  status: "running" | "completed" | "cancelled" | "error";
  statusDetail?: string;
  statusDetailBase?: string;
  countdownEndAt?: number;
  countdownLabel?: string;
  countdownRemainingSec?: number;
  isPaused?: boolean;
  errorMessage?: string;
  updatedAt: number;
};

type LayoutConfig = {
  openOffset: number;
  collapsedOffset: number;
};

const parseCssPx = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const resolveAppRoot = () =>
  document.querySelector<HTMLElement>("#app") ??
  document.querySelector<HTMLElement>("[data-testid='app']") ??
  document.querySelector<HTMLElement>("[data-testid='whatsapp-web']") ??
  document.querySelector<HTMLElement>("div[id^='mount_']") ??
  document.body;

const applyLayoutOffset = (root: HTMLElement, offset: number) => {
  const offsetValue = `${offset}px`;

  root.style.boxSizing = "border-box";
  root.style.transition = "width 0.35s ease, max-width 0.35s ease, margin 0.35s ease, right 0.35s ease";
  root.style.width = `calc(100% - ${offsetValue})`;
  root.style.maxWidth = `calc(100% - ${offsetValue})`;
  root.style.marginRight = offsetValue;
  root.style.right = offsetValue;

  document.documentElement.style.setProperty("--zop-sidebar-offset", offsetValue);
  document.body.style.overflowX = "hidden";
};

const setCollapsed = (shell: HTMLElement, collapsed: boolean, layout?: LayoutConfig) => {
  shell.classList.toggle("is-collapsed", collapsed);
  const toggle = shell.querySelector<HTMLButtonElement>("#zop-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.dataset.state = collapsed ? "closed" : "open";
  }

  if (layout) {
    const root = resolveAppRoot();
    const offset = collapsed ? layout.collapsedOffset : layout.openOffset;
    applyLayoutOffset(root, offset);
  }
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

const requestActiveChat = () => requestPageBridge<ActiveChat | null>({ type: "active-chat" }, 3000);

const PIX_STORAGE_NAME_KEY = "zopPixNomePadrao";
const PIX_STORAGE_MODE_KEY = "zopPixTipoPadrao";
const PIX_MODE_OPTIONS = [
  { value: "CPF", label: "CPF" },
  { value: "CNPJ", label: "CNPJ" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "EVP", label: "Chave aleatória" }
] as const;

type PixPreference = {
  name?: string;
  mode?: string;
};

const getStoredPixPreferences = (): Promise<PixPreference> =>
  new Promise((resolve) => {
    const fallback = {
      name: typeof localStorage !== "undefined" ? localStorage.getItem(PIX_STORAGE_NAME_KEY) ?? undefined : undefined,
      mode: typeof localStorage !== "undefined" ? localStorage.getItem(PIX_STORAGE_MODE_KEY) ?? undefined : undefined
    };

    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get([PIX_STORAGE_NAME_KEY, PIX_STORAGE_MODE_KEY], (items) => {
        resolve({
          name: typeof items?.[PIX_STORAGE_NAME_KEY] === "string" ? items[PIX_STORAGE_NAME_KEY] : fallback.name,
          mode: typeof items?.[PIX_STORAGE_MODE_KEY] === "string" ? items[PIX_STORAGE_MODE_KEY] : fallback.mode
        });
      });
      return;
    }

    resolve(fallback);
  });

const setStoredPixPreferences = (updates: PixPreference) => {
  const payload: Record<string, string> = {};
  if (typeof updates.name === "string") {
    payload[PIX_STORAGE_NAME_KEY] = updates.name;
  }
  if (typeof updates.mode === "string") {
    payload[PIX_STORAGE_MODE_KEY] = updates.mode;
  }
  if (Object.keys(payload).length === 0) {
    return;
  }

  try {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.set(payload);
      return;
    }

    if (typeof payload[PIX_STORAGE_NAME_KEY] === "string") {
      localStorage.setItem(PIX_STORAGE_NAME_KEY, payload[PIX_STORAGE_NAME_KEY]);
    }
    if (typeof payload[PIX_STORAGE_MODE_KEY] === "string") {
      localStorage.setItem(PIX_STORAGE_MODE_KEY, payload[PIX_STORAGE_MODE_KEY]);
    }
  } catch (error) {
    console.warn("[ZOP][PIX] Falha ao salvar preferências", error);
  }
};

const setupPanelNavigation = (shadow: ShadowRoot) => {
  const railItems = Array.from(shadow.querySelectorAll<HTMLButtonElement>(".zop-rail__item"));
  const panels = Array.from(shadow.querySelectorAll<HTMLElement>(".zop-panel"));

  const setActivePanel = (panelId: string) => {
    railItems.forEach((item) => item.classList.toggle("is-active", item.dataset.panel === panelId));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === panelId));
  };

  const current = railItems.find((item) => item.classList.contains("is-active"));
  if (current?.dataset.panel) {
    setActivePanel(current.dataset.panel);
  }

  return { railItems, setActivePanel };
};

const setupChipGroup = (shadow: ShadowRoot, selector: string) => {
  const chips = Array.from(shadow.querySelectorAll<HTMLButtonElement>(selector));
  if (chips.length === 0) {
    return;
  }

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((item) => item.classList.toggle("is-active", item === chip));
    });
  });
};

export const mountSidebar = () => {
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${sidebarCss}</style>${sidebarHtml}`;

  (document.body || document.documentElement).appendChild(host);

  const shell = shadow.querySelector<HTMLElement>(".zop-shell");
  const toggle = shadow.querySelector<HTMLButtonElement>("#zop-toggle");
  if (!shell || !toggle) {
    return;
  }

  const hostStyles = getComputedStyle(host);
  const sidebarWidth = parseCssPx(hostStyles.getPropertyValue("--zop-sidebar-width")) ?? 420;
  const collapsedWidth =
    parseCssPx(hostStyles.getPropertyValue("--zop-collapsed-width")) ??
    parseCssPx(hostStyles.getPropertyValue("--zop-rail-width")) ??
    96;
  let layout: LayoutConfig = {
    openOffset: sidebarWidth,
    collapsedOffset: collapsedWidth
  };

  const logo = shadow.querySelector<HTMLImageElement>("#zop-logo");
  const logoRail = shadow.querySelector<HTMLImageElement>("#zop-logo-rail");
  if (logo) {
    logo.src = chrome.runtime.getURL("logo-zaporganic.png");
  }
  if (logoRail) {
    logoRail.src = chrome.runtime.getURL("logo-zaporganic.png");
  }

  const openOptionsButton = shadow.querySelector<HTMLButtonElement>("#zop-open-options");
  const openOptionsHandler = () => {
    if (chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    if (chrome?.runtime?.getURL) {
      window.open(chrome.runtime.getURL("options/options.html"), "_blank");
    }
  };

  openOptionsButton?.addEventListener("click", openOptionsHandler);

  const openOptionsFunnelButton = shadow.querySelector<HTMLButtonElement>("[data-action='open-options']");
  openOptionsFunnelButton?.addEventListener("click", openOptionsHandler);

  const openPixButton = shadow.querySelector<HTMLButtonElement>("#zop-open-pix");

  async function openPixModal() {
    if (document.getElementById("zop-pix-backdrop")) {
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.id = "zop-pix-backdrop";
    backdrop.className = "zop-pix-backdrop";

    const modal = document.createElement("div");
    modal.className = "zop-pix-modal";
    modal.innerHTML = `
      <h3 style="margin:0;font-size:20px">Enviar PIX</h3>

      <div class="zop-pix-field">
        <span class="zop-pix-label">Tipo</span>
        <div class="zop-pix-radio-group">
          ${PIX_MODE_OPTIONS.map(
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
    document.documentElement.classList.add("zop-pix-modal-open");
    document.body.classList.add("zop-pix-modal-open");

    const nameInput = modal.querySelector<HTMLInputElement>("#zop-pix-name");
    const keyInput = modal.querySelector<HTMLTextAreaElement>("#zop-pix-key");
    const sendButton = modal.querySelector<HTMLButtonElement>("#zop-pix-send");
    const cancelButton = modal.querySelector<HTMLButtonElement>("#zop-pix-cancel");
    const errorEl = modal.querySelector<HTMLElement>("#zop-pix-name-error");
    const modes = Array.from(modal.querySelectorAll<HTMLInputElement>('input[name="zop-pix-mode"]'));

    const setError = (message: string) => {
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = message ? "block" : "none";
      }
    };

    const cleanup = () => {
      backdrop.remove();
      document.documentElement.classList.remove("zop-pix-modal-open");
      document.body.classList.remove("zop-pix-modal-open");
    };

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        cleanup();
      }
    });

    cancelButton?.addEventListener("click", () => cleanup());

    const persistName = () => {
      const value = nameInput?.value.trim() || "";
      setStoredPixPreferences({ name: value });
    };

    const persistMode = (value: string) => {
      setStoredPixPreferences({ mode: value });
    };

    nameInput?.addEventListener("input", () => {
      setError("");
      persistName();
    });
    nameInput?.addEventListener("blur", () => {
      persistName();
    });

    modes.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          persistMode(radio.value);
        }
      });
    });

    try {
      const stored = await getStoredPixPreferences();
      if (stored.name && nameInput) {
        nameInput.value = stored.name;
      }
      if (stored.mode) {
        const radio = modal.querySelector<HTMLInputElement>(`input[name="zop-pix-mode"][value="${stored.mode}"]`);
        if (radio) {
          radio.checked = true;
        }
      }
    } catch (error) {
      console.warn("[ZOP][PIX] Falha ao carregar preferencias", error);
    }

    sendButton?.addEventListener("click", async (event) => {
      event.preventDefault();
      setError("");
      const selectedMode = modal.querySelector<HTMLInputElement>('input[name="zop-pix-mode"]:checked');
      const mode = selectedMode?.value || PIX_MODE_OPTIONS[0].value;
      const nameValue = nameInput?.value.trim() || "";
      const keyValue = keyInput?.value.trim() || "";
      if (!nameValue) {
        setError("Informe o nome.");
        nameInput?.focus();
        return;
      }
      if (!keyValue) {
        keyInput?.focus();
        return;
      }
      persistName();
      persistMode(mode);
      try {
        const chat = await requestActiveChat();
        activeChat = chat;
        if (chat && activeChatLabel) {
          activeChatLabel.textContent = chat.name || chat.id || "Conversa ativa";
        }
        if (!chat?.id) {
          alert("Abra uma conversa para enviar o PIX.");
          return;
        }

        const response = await requestPageBridge<SendMessageResult>({
          type: "send-pix",
          chatId: chat.id,
          keyType: mode,
          key: keyValue,
          name: nameValue,
          instructions: ""
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Falha ao enviar o PIX.");
        }

        if (activeChatLabel) {
          activeChatLabel.textContent = "PIX enviado";
        }
        cleanup();
      } catch (error) {
        alert(error?.message || "Falha ao enviar PIX.");
      }
    });
  }

  openPixButton?.addEventListener("click", () => {
    void openPixModal();
  });

  const COMPOSER_SELECTOR = "#main > footer ._1oI7S > div, #main > footer ._3wpi1 > div, #main > footer ._3uMse > div, #main > footer ._3h5ME > div";
  const ensureComposerButton = () => {
    const hosts = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR));
    hosts.forEach((host) => {
      if (!host || host.querySelector("#zop-pix-inline")) {
        return;
      }
      const button = document.createElement("button");
      button.id = "zop-pix-inline";
      button.type = "button";
      button.title = "Enviar PIX";
      button.textContent = "💸";
      button.addEventListener("click", () => {
        void openPixModal();
      });
      host.prepend(button);
    });
  };

  let composerObserver: MutationObserver | null = null;
  const startComposerObserver = () => {
    composerObserver?.disconnect();
    composerObserver = new MutationObserver(() => {
      ensureComposerButton();
    });
    composerObserver.observe(document.body, { childList: true, subtree: true });
  };

  ensureComposerButton();
  startComposerObserver();

  let collapsed = true;
  setCollapsed(shell, collapsed, layout);

  const toggleCollapsed = () => {
    collapsed = !collapsed;
    setCollapsed(shell, collapsed, layout);
  };

  toggle.addEventListener("click", () => {
    toggleCollapsed();
  });

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.code !== TOGGLE_SHORTCUT) {
      return;
    }

    event.preventDefault();
    toggleCollapsed();
  });

  const railToggle = shadow.querySelector<HTMLButtonElement>("#zop-rail-toggle");
  railToggle?.addEventListener("click", () => {
    toggleCollapsed();
  });

  const { railItems, setActivePanel } = setupPanelNavigation(shadow);
  railItems.forEach((item) => {
    item.addEventListener("click", () => {
      const panelId = item.dataset.panel;
      if (!panelId) {
        return;
      }

      if (collapsed) {
        setActivePanel(panelId);
        collapsed = false;
        setCollapsed(shell, collapsed, layout);
        return;
      }

      const isSamePanel = item.classList.contains("is-active");
      if (isSamePanel) {
        collapsed = true;
        setCollapsed(shell, collapsed, layout);
        return;
      }

      setActivePanel(panelId);
    });
  });
  setupChipGroup(shadow, ".zop-chip");
  setupChipGroup(shadow, ".zop-pill-group .zop-pill");

  const wppStatus = shadow.querySelector<HTMLElement>("#zop-wpp-status");
  const funnelTotal = shadow.querySelector<HTMLElement>("#zop-funnel-total");
  const activeChatLabel = shadow.querySelector<HTMLElement>("#zop-active-chat");
  const funnelList = shadow.querySelector<HTMLElement>("#zop-funnel-list");
  const funnelEmpty = shadow.querySelector<HTMLElement>("#zop-funnel-empty");
  const funnelSearch = shadow.querySelector<HTMLInputElement>("#zop-funnel-search");
  const quickReplyList = shadow.querySelector<HTMLElement>("#zop-quickreply-list");
  const quickReplyEmpty = shadow.querySelector<HTMLElement>("#zop-quickreply-empty");
  const runsList = shadow.querySelector<HTMLElement>("#zop-runs-list");
  const runsEmpty = shadow.querySelector<HTMLElement>("#zop-runs-empty");
  const refreshButton = shadow.querySelector<HTMLButtonElement>("#zop-refresh-chat");

  let funnels: Funnel[] = [];
  let quickReplies: QuickReply[] = [];
  let integrationSettings: IntegrationSettings = DEFAULT_INTEGRATION_SETTINGS;
  let activeChat: ActiveChat | null = null;
  let funnelFilter = "";
  let runnerBound = false;
  const runs = new Map<string, FunnelRunView>();

  const updateTotals = () => {
    if (!funnelTotal) {
      return;
    }

    funnelTotal.textContent = `${funnels.length} funis`;
  };

  const updateActiveChatUI = () => {
    if (activeChatLabel) {
      activeChatLabel.textContent = activeChat?.name || activeChat?.id || "Nenhuma conversa selecionada";
    }
  };

  const formatStepType = (step: FunnelStep) => {
    switch (step.type) {
      case "text":
        return "Mensagem";
      case "delay":
        return "Delay";
      case "tag":
        return "Etiqueta";
      case "webhook":
        return "Webhook";
      case "audio":
        return "Audio";
      case "ptt":
        return "PTT (gravado)";
      case "ptv":
        return "Video recado";
      case "image":
        return "Imagem";
      case "video":
        return "Video";
      case "file":
        return "Arquivo";
      default:
        return "Etapa";
    }
  };

  const formatStepSummary = (step: FunnelStep) => {
    if (step.type === "text") {
      return step.text?.trim() || "Mensagem vazia";
    }

    if (step.type === "delay") {
      return step.delayExpr?.trim() || (Number.isFinite(step.delaySec) ? `${step.delaySec} s` : "Delay");
    }

    if (step.type === "tag") {
      const tags = step.addTags?.filter(Boolean).join(", ");
      return tags ? `Tags: ${tags}` : "Adicionar tags";
    }

    if (step.type === "webhook") {
      return step.webhookEvent ? `Evento: ${step.webhookEvent}` : "Webhook";
    }

    if (step.type === "audio" || step.type === "ptt" || step.type === "ptv" || step.type === "image" || step.type === "video" || step.type === "file") {
      return step.fileName?.trim() || step.mediaCaption?.trim() || formatStepType(step);
    }

    return "Etapa";
  };

  const formatDelayStatus = (step: FunnelStep, resolvedDelaySec?: number) => {
    if (step.type !== "delay" && step.type !== "text") {
      return null;
    }

    const delaySec = resolvedDelaySec ?? resolveDelaySec(step, integrationSettings.defaultDelaySec ?? 0);
    if (!delaySec) {
      return null;
    }

    return `Aguardando ${delaySec} s...`;
  };

  const isMediaStep = (step: FunnelStep) =>
    step.type === "audio" ||
    step.type === "ptt" ||
    step.type === "ptv" ||
    step.type === "image" ||
    step.type === "video" ||
    step.type === "file";

  const getStepTimeoutSec = (step: FunnelStep) => {
    switch (step.type) {
      case "video":
      case "ptv":
        return 120;
      case "audio":
      case "ptt":
        return 60;
      case "file":
        return 90;
      case "image":
        return 45;
      default:
        return 30;
    }
  };

  const getFunnelRunner = () => {
    const target = window as Window &
      typeof globalThis & {
        zopFunnelRunner?: {
          runFunnel: (input: {
            funnel: Funnel;
            chatId: string;
            lead: LeadCard;
            integrationSettings: IntegrationSettings;
          }) => string;
          cancel: (runId: string) => void;
          pause: (runId: string) => void;
          resume: (runId: string) => void;
          onStepStart: (listener: (event: FunnelStepEvent) => void) => () => void;
          onStepDone: (listener: (event: FunnelStepEvent) => void) => () => void;
          onError: (listener: (event: FunnelErrorEvent) => void) => () => void;
          onFinished: (listener: (event: FunnelFinishedEvent) => void) => () => void;
        };
      };

    return target.zopFunnelRunner ?? null;
  };

  const ensureRunnerEvents = () => {
    if (runnerBound) {
      return;
    }

    const runner = getFunnelRunner();
    if (!runner) {
      window.setTimeout(ensureRunnerEvents, 300);
      return;
    }

    runnerBound = true;

    runner.onStepStart((event) => {
      const run = runs.get(event.runId);
      if (!run) {
        return;
      }

      run.currentStepIndex = event.stepIndex;
      run.currentStep = event.step;
      run.status = "running";
      run.isPaused = false;
      run.statusDetailBase = `${formatStepType(event.step)} em andamento`;
      run.statusDetail = formatDelayStatus(event.step, event.resolvedDelaySec) || run.statusDetailBase;
      if (event.resolvedDelaySec && event.resolvedDelaySec > 0) {
        run.countdownEndAt = event.ts + event.resolvedDelaySec * 1000;
        run.countdownLabel = "Aguardando";
        ensureCountdownTimer();
      } else if (isMediaStep(event.step)) {
        run.countdownEndAt = event.ts + getStepTimeoutSec(event.step) * 1000;
        run.countdownLabel = "Enviando";
        ensureCountdownTimer();
      } else {
        run.countdownEndAt = undefined;
        run.countdownLabel = undefined;
      }
      run.updatedAt = Date.now();
      renderRuns();
    });

    runner.onStepDone((event) => {
      const run = runs.get(event.runId);
      if (!run) {
        return;
      }

      run.completedSteps = Math.max(run.completedSteps, event.stepIndex + 1);
      run.currentStepIndex = event.stepIndex;
      run.currentStep = event.step;
      run.statusDetail = `${formatStepType(event.step)} concluida`;
      run.statusDetailBase = undefined;
      run.isPaused = false;
      run.countdownEndAt = undefined;
      run.countdownLabel = undefined;
      run.countdownRemainingSec = undefined;
      run.updatedAt = Date.now();
      renderRuns();
    });

    runner.onError((event) => {
      const run = runs.get(event.runId);
      if (!run) {
        return;
      }

      run.status = "error";
      run.errorMessage = event.error ? String(event.error) : "Erro desconhecido";
      run.statusDetail = run.errorMessage;
      run.statusDetailBase = undefined;
      run.isPaused = false;
      run.countdownEndAt = undefined;
      run.countdownLabel = undefined;
      run.countdownRemainingSec = undefined;
      run.updatedAt = Date.now();
      renderRuns();
    });

    runner.onFinished((event) => {
      const run = runs.get(event.runId);
      if (!run) {
        return;
      }

      run.status = event.status;
      run.updatedAt = Date.now();
      if (event.status === "completed") {
        run.completedSteps = run.totalSteps;
        run.statusDetail = "Finalizado";
      } else if (event.status === "cancelled") {
        run.statusDetail = "Cancelado";
      } else if (event.status === "error") {
        run.statusDetail = run.errorMessage || "Erro";
      }
      run.statusDetailBase = undefined;
      run.isPaused = false;
      run.countdownEndAt = undefined;
      run.countdownLabel = undefined;
      run.countdownRemainingSec = undefined;
      renderRuns();
    });
  };

  const renderFunnelList = () => {
    if (!funnelList || !funnelEmpty) {
      return;
    }

    const query = funnelFilter.trim().toLowerCase();
    const filtered = funnels.filter((funnel) => {
      if (!query) {
        return true;
      }

      const steps = Array.isArray(funnel.steps) ? funnel.steps : [];
      const haystack = [
        funnel.name ?? "",
        funnel.description ?? "",
        ...steps.map((step) => `${formatStepType(step)} ${formatStepSummary(step)}`)
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });

    funnelList.innerHTML = "";
    funnelEmpty.style.display = filtered.length === 0 ? "grid" : "none";

    filtered.forEach((funnel) => {
      const steps = Array.isArray(funnel.steps) ? funnel.steps : [];
      const card = document.createElement("div");
      card.className = "zop-funnel-card";
      card.innerHTML = `
        <div class="zop-funnel-card__head">
          <div>
            <div class="zop-funnel-card__title">${funnel.name || "Funil sem nome"}</div>
            ${funnel.description ? `<div class="zop-funnel-card__subtitle">${funnel.description}</div>` : ""}
          </div>
          <span class="zop-funnel-card__meta">${steps.length} etapas</span>
        </div>
        <div class="zop-funnel-card__steps">
          ${steps
            .map(
              (step, index) => `
                <div class="zop-step">
                  <span class="zop-step__index">${index + 1}</span>
                  <span class="zop-step__type">${formatStepType(step)}</span>
                  <span class="zop-step__summary">${formatStepSummary(step)}</span>
                </div>
              `
            )
            .join("")}
        </div>
        <div class="zop-funnel-card__actions">
          <button class="zop-button" type="button" data-funnel-id="${funnel.id}">
            Executar no chat ativo
          </button>
        </div>
      `;

      const action = card.querySelector<HTMLButtonElement>("button[data-funnel-id]");
      action?.addEventListener("click", () => {
        void runFunnelForActiveChat(funnel);
      });

      funnelList.appendChild(card);
    });
  };

  const renderQuickReplies = () => {
    if (!quickReplyList || !quickReplyEmpty) {
      return;
    }

    const grouped = quickReplies.reduce<Map<string, QuickReply[]>>((acc, reply) => {
      const key = reply.categoryId?.trim() || "Sem categoria";
      const list = acc.get(key) ?? [];
      list.push(reply);
      acc.set(key, list);
      return acc;
    }, new Map());

    quickReplyList.innerHTML = "";
    quickReplyEmpty.style.display = quickReplies.length === 0 ? "grid" : "none";

    Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([category, replies]) => {
        const group = document.createElement("div");
        group.className = "zop-qr-group";
        group.innerHTML = `
          <div class="zop-qr-group__title">${category}</div>
          <div class="zop-qr-group__list"></div>
        `;

        const list = group.querySelector<HTMLElement>(".zop-qr-group__list");
        replies
          .sort((a, b) => a.title.localeCompare(b.title))
          .forEach((reply) => {
            const item = document.createElement("div");
            item.className = "zop-qr-item";
            const messagePreview = reply.message.trim().slice(0, 120);
            item.innerHTML = `
              <div>
                <div class="zop-qr-title">${reply.title}</div>
                <div class="zop-qr-message">${messagePreview}</div>
              </div>
              <div class="zop-qr-actions">
                <button class="zop-button zop-button--ghost" type="button" data-action="insert">
                  Inserir
                </button>
                <button class="zop-button" type="button" data-action="send">
                  Enviar
                </button>
              </div>
            `;

            const insertButton = item.querySelector<HTMLButtonElement>("button[data-action='insert']");
            insertButton?.addEventListener("click", () => {
              void insertQuickReply(reply);
            });

            const sendButton = item.querySelector<HTMLButtonElement>("button[data-action='send']");
            sendButton?.addEventListener("click", () => {
              void sendQuickReply(reply);
            });

            list?.appendChild(item);
          });

        quickReplyList.appendChild(group);
      });
  };

  const renderRuns = () => {
    if (!runsList || !runsEmpty) {
      return;
    }

    const list = Array.from(runs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    runsList.innerHTML = "";
    runsEmpty.style.display = list.length === 0 ? "grid" : "none";

    list.forEach((run) => {
      const progress = run.totalSteps
        ? Math.min((run.completedSteps / run.totalSteps) * 100, 100)
        : 0;
      const stepLabel = run.currentStep ? formatStepType(run.currentStep) : "Aguardando";
      const statusClass = `zop-run__status--${run.status}`;
      const statusLabel =
        run.isPaused
          ? "pausado"
          : run.status === "running"
            ? "ativo"
            : run.status === "completed"
              ? "finalizado"
              : run.status === "cancelled"
                ? "cancelado"
                : "erro";
      const card = document.createElement("div");
      card.className = "zop-run-card";
      card.innerHTML = `
        <div class="zop-run-card__head">
          <div>
            <div class="zop-run-title">${run.funnelName}</div>
            <div class="zop-run-meta">${run.chatName || run.chatId}</div>
          </div>
          <span class="zop-run-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="zop-progress">
          <div class="zop-progress__bar" style="width: ${progress}%"></div>
        </div>
        <div class="zop-run-detail">
          <span>${stepLabel}</span>
          <span>${run.statusDetail ?? ""}</span>
        </div>
        <div class="zop-run-actions">
          <span class="zop-run-meta">${run.completedSteps}/${run.totalSteps} etapas</span>
          <button class="zop-button zop-button--ghost" type="button" data-action="pause" data-run-id="${run.runId}" ${
            run.status !== "running" ? "disabled" : ""
          }>
            ${run.isPaused ? "Retomar" : "Pausar"}
          </button>
          <button class="zop-button zop-button--ghost" type="button" data-action="cancel" data-run-id="${run.runId}" ${
            run.status !== "running" ? "disabled" : ""
          }>
            Cancelar
          </button>
        </div>
      `;

      const pauseButton = card.querySelector<HTMLButtonElement>("button[data-action='pause'][data-run-id]");
      pauseButton?.addEventListener("click", () => {
        const runner = getFunnelRunner();
        if (!runner) {
          return;
        }
        run.isPaused = !run.isPaused;
        if (run.isPaused) {
          if (run.countdownEndAt) {
            run.countdownRemainingSec = Math.max(
              0,
              Math.ceil((run.countdownEndAt - Date.now()) / 1000)
            );
          }
          run.countdownEndAt = undefined;
          run.statusDetailBase = run.statusDetailBase ?? run.statusDetail;
          run.statusDetail = "Pausado";
          runner.pause(run.runId);
        } else {
          if (run.countdownRemainingSec && run.countdownRemainingSec > 0) {
            run.countdownEndAt = Date.now() + run.countdownRemainingSec * 1000;
          }
          run.countdownRemainingSec = undefined;
          run.statusDetail = run.statusDetailBase ?? run.statusDetail;
          runner.resume(run.runId);
        }
        renderRuns();
      });

      const cancelButton = card.querySelector<HTMLButtonElement>("button[data-action='cancel'][data-run-id]");
      cancelButton?.addEventListener("click", () => {
        const runner = getFunnelRunner();
        run.isPaused = false;
        run.countdownEndAt = undefined;
        run.countdownRemainingSec = undefined;
        runner?.cancel(run.runId);
        renderRuns();
      });

      runsList.appendChild(card);
    });
  };

  const updateCountdowns = () => {
    const now = Date.now();
    let changed = false;
    runs.forEach((run) => {
      if (run.status !== "running" || run.isPaused || !run.countdownEndAt) {
        return;
      }

      const remaining = Math.max(0, Math.ceil((run.countdownEndAt - now) / 1000));
      if (remaining > 0) {
        const label = run.countdownLabel || "Aguardando";
        run.statusDetail = `${label} ${remaining}s`;
        changed = true;
        return;
      }

      run.countdownEndAt = undefined;
      run.statusDetail = run.statusDetailBase ?? run.statusDetail;
      changed = true;
    });

    if (changed) {
      renderRuns();
    }
  };

  let countdownTimer: number | null = null;
  const ensureCountdownTimer = () => {
    if (countdownTimer) {
      return;
    }
    countdownTimer = window.setInterval(updateCountdowns, 1000);
  };

  const loadFunnels = async () => {
    const stored = await loadData<Funnel[]>(FUNNEL_STORAGE_KEY, []);
    funnels = Array.isArray(stored) ? stored : [];
    updateTotals();
    renderFunnelList();
  };

  const loadQuickReplies = async () => {
    const stored = await loadData<QuickReply[]>(QUICK_REPLY_STORAGE_KEY, []);
    quickReplies = Array.isArray(stored) ? stored : [];
    renderQuickReplies();
  };

  const loadIntegrationSettings = async () => {
    const stored = await loadData<IntegrationSettings>(SETTINGS_STORAGE_KEY, DEFAULT_INTEGRATION_SETTINGS);
    integrationSettings = { ...DEFAULT_INTEGRATION_SETTINGS, ...(stored ?? {}) };
  };

  const refreshActiveChat = async () => {
    const chat = await requestActiveChat();
    activeChat = chat;
    updateActiveChatUI();
  };

  const createLeadFromChat = (chat: ActiveChat): LeadCard => ({
    id: chat.id,
    chatId: chat.id,
    title: chat.name || chat.id,
    laneId: "novo",
    tags: [],
    lastUpdateAt: Date.now()
  });

  const runFunnelForActiveChat = async (funnel: Funnel) => {
    const chat = await requestActiveChat();
    activeChat = chat;
    updateActiveChatUI();
    if (!chat) {
      if (activeChatLabel) {
        activeChatLabel.textContent = "Abra uma conversa para executar o funil";
      }
      return;
    }

    const runner = getFunnelRunner();
    if (!runner) {
      if (activeChatLabel) {
        activeChatLabel.textContent = "Runner indisponivel no momento";
      }
      return;
    }

    const lead = createLeadFromChat(chat);
    const runId = runner.runFunnel({
      funnel,
      chatId: chat.id,
      lead,
      integrationSettings
    });

    runs.set(runId, {
      runId,
      funnelId: funnel.id,
      funnelName: funnel.name,
      chatId: chat.id,
      chatName: chat.name,
      totalSteps: funnel.steps.length,
      completedSteps: 0,
      currentStepIndex: 0,
      status: "running",
      statusDetail: "Iniciando...",
      isPaused: false,
      updatedAt: Date.now()
    });
    renderRuns();
  };

  const insertQuickReply = async (reply: QuickReply) => {
    const chat = await requestActiveChat();
    activeChat = chat;
    updateActiveChatUI();
    if (!chat) {
      if (activeChatLabel) {
        activeChatLabel.textContent = "Abra uma conversa para inserir a mensagem";
      }
      return;
    }

    const response = await requestPageBridge<SendMessageResult>({
      type: "insert-text",
      chatId: chat.id,
      text: reply.message
    });

    if (!response?.ok && activeChatLabel) {
      activeChatLabel.textContent = "Nao foi possivel inserir a mensagem";
    }
  };

  const sendQuickReply = async (reply: QuickReply) => {
    const chat = await requestActiveChat();
    activeChat = chat;
    updateActiveChatUI();
    if (!chat) {
      if (activeChatLabel) {
        activeChatLabel.textContent = "Abra uma conversa para enviar a mensagem";
      }
      return;
    }

    const response = await requestPageBridge<SendMessageResult>({
      type: "send-text",
      chatId: chat.id,
      text: reply.message
    });

    if (!response?.ok && activeChatLabel) {
      activeChatLabel.textContent = "Nao foi possivel enviar a mensagem";
    }
  };

  funnelSearch?.addEventListener("input", (event) => {
    funnelFilter = (event.target as HTMLInputElement).value;
    renderFunnelList();
  });

  refreshButton?.addEventListener("click", () => {
    void refreshActiveChat();
  });

  void Promise.all([loadFunnels(), loadQuickReplies(), loadIntegrationSettings()]).then(() => {
    updateTotals();
    renderFunnelList();
    renderQuickReplies();
  });

  void refreshActiveChat();
  ensureRunnerEvents();

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }

      if (changes[FUNNEL_STORAGE_KEY]) {
        void loadFunnels();
      }

      if (changes[QUICK_REPLY_STORAGE_KEY]) {
        void loadQuickReplies();
      }

      if (changes[SETTINGS_STORAGE_KEY]) {
        void loadIntegrationSettings();
      }
    });
  }

  if (wppStatus) {
    window.addEventListener("zop:wpp", (event) => {
      const detail = (event as CustomEvent<WppEventDetail>).detail;
      if (!detail) {
        return;
      }

      wppStatus.textContent = detail.status === "ready" ? "WPP ativo" : "WPP timeout";
      if (detail.status === "ready") {
        void refreshActiveChat();
      }
    });
  }
};
