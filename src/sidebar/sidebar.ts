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
      run.statusDetail =
        formatDelayStatus(event.step, event.resolvedDelaySec) || `${formatStepType(event.step)} em andamento`;
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
        run.status === "running"
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
          <button class="zop-button zop-button--ghost" type="button" data-run-id="${run.runId}" ${
            run.status !== "running" ? "disabled" : ""
          }>
            Cancelar
          </button>
        </div>
      `;

      const cancelButton = card.querySelector<HTMLButtonElement>("button[data-run-id]");
      cancelButton?.addEventListener("click", () => {
        const runner = getFunnelRunner();
        runner?.cancel(run.runId);
      });

      runsList.appendChild(card);
    });
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
