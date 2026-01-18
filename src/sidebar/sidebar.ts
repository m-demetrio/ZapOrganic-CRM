import sidebarHtml from "./sidebar.html?raw";
import sidebarCss from "./sidebar.css?raw";

const HOST_ID = "zop-sidebar-root";
const TOGGLE_SHORTCUT = "KeyY";
const STORAGE_KEY = "zopFunnelState";
const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";

const FUNNEL_OPTIONS = [
  { id: "max", label: "MAX FUNIL", color: "var(--zop-purple-light)" },
  { id: "super", label: "FUNIL SUPER, PRO E MAX", color: "var(--zop-purple-main)" },
  { id: "juros", label: "JUROS ALTOS", color: "var(--zop-purple-alt)" },
  { id: "vale", label: "VALE REFEICAO", color: "var(--zop-purple-mid)" },
  { id: "pagar", label: "PAGAR QUANDO CHEGAR", color: "var(--zop-green-main)" }
];

type WppEventDetail = {
  status: "ready" | "timeout";
  version?: string;
};

type ActiveChat = {
  id: string;
  name?: string;
};

type FunnelEntry = {
  stage: string;
  name?: string;
  updatedAt: number;
};

type FunnelState = Record<string, FunnelEntry>;

type LayoutConfig = {
  openOffset: number;
  collapsedOffset: number;
};

const getFunnelLabel = (stageId?: string) => {
  if (!stageId) {
    return "Sem funil";
  }

  return FUNNEL_OPTIONS.find((stage) => stage.id === stageId)?.label ?? "Sem funil";
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

const getStorageValue = async <T>(key: string, fallback: T): Promise<T> => {
  if (chrome?.storage?.local) {
    return await new Promise<T>((resolve) => {
      chrome.storage.local.get([key], (result) => {
        const value = result[key] as T | undefined;
        resolve(value ?? fallback);
      });
    });
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const setStorageValue = async (key: string, value: unknown) => {
  if (chrome?.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
};

const createRequestId = () => `zop-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const requestActiveChat = async () => {
  const id = createRequestId();

  return await new Promise<ActiveChat | null>((resolve) => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; payload?: ActiveChat | null }>).detail;
      if (!detail || detail.id !== id) {
        return;
      }

      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve(detail.payload ?? null);
    };

    window.addEventListener(RESPONSE_EVENT, handler);
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: {
          id,
          type: "active-chat"
        }
      })
    );

    window.setTimeout(() => {
      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve(null);
    }, 3000);
  });
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
  if (logo) {
    logo.src = chrome.runtime.getURL("logo-zaporganic.png");
  }

  let collapsed = true;
  setCollapsed(shell, collapsed, layout);

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    setCollapsed(shell, collapsed, layout);
  });

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.code !== TOGGLE_SHORTCUT) {
      return;
    }

    event.preventDefault();
    collapsed = !collapsed;
    setCollapsed(shell, collapsed, layout);
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
  const activeStageLabel = shadow.querySelector<HTMLElement>("#zop-active-stage");
  const funnelList = shadow.querySelector<HTMLElement>("#zop-funnel-list");
  const refreshButton = shadow.querySelector<HTMLButtonElement>("#zop-refresh-chat");

  let funnelState: FunnelState = {};
  let activeChat: ActiveChat | null = null;

  const updateTotals = () => {
    if (!funnelTotal) {
      return;
    }

    const total = Object.keys(funnelState).length;
    funnelTotal.textContent = `${total} ativos`;
  };

  const updateActiveChatUI = () => {
    if (activeChatLabel) {
      activeChatLabel.textContent = activeChat?.name || activeChat?.id || "Nenhuma conversa selecionada";
    }

    if (activeStageLabel) {
      const stageId = activeChat ? funnelState[activeChat.id]?.stage : undefined;
      activeStageLabel.textContent = getFunnelLabel(stageId);
    }
  };

  const renderFunnelList = () => {
    if (!funnelList) {
      return;
    }

    const counts = FUNNEL_OPTIONS.reduce<Record<string, number>>((acc, stage) => {
      acc[stage.id] = 0;
      return acc;
    }, {});

    Object.values(funnelState).forEach((entry) => {
      if (entry?.stage && counts[entry.stage] !== undefined) {
        counts[entry.stage] += 1;
      }
    });

    const activeStage = activeChat ? funnelState[activeChat.id]?.stage : undefined;

    funnelList.innerHTML = "";
    FUNNEL_OPTIONS.forEach((stage) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `zop-funnel__item${activeStage === stage.id ? " is-active" : ""}`;
      item.dataset.stage = stage.id;
      item.innerHTML = `
        <span class="zop-funnel__dot" style="--zop-funnel-color: ${stage.color}"></span>
        <span class="zop-funnel__name">${stage.label}</span>
        <span class="zop-funnel__count">${counts[stage.id]}</span>
      `;
      item.addEventListener("click", () => {
        void setStageForActive(stage.id);
      });
      funnelList.appendChild(item);
    });
  };

  const loadFunnelState = async () => {
    funnelState = await getStorageValue<FunnelState>(STORAGE_KEY, {});
  };

  const saveFunnelState = async () => {
    await setStorageValue(STORAGE_KEY, funnelState);
  };

  const setStageForActive = async (stageId: string) => {
    if (!activeChat) {
      if (activeChatLabel) {
        activeChatLabel.textContent = "Abra uma conversa para definir o funil";
      }
      return;
    }

    funnelState = {
      ...funnelState,
      [activeChat.id]: {
        stage: stageId,
        name: activeChat.name,
        updatedAt: Date.now()
      }
    };

    await saveFunnelState();
    updateActiveChatUI();
    updateTotals();
    renderFunnelList();
  };

  const refreshActiveChat = async () => {
    const chat = await requestActiveChat();
    activeChat = chat;
    updateActiveChatUI();
    renderFunnelList();
  };

  refreshButton?.addEventListener("click", () => {
    void refreshActiveChat();
  });

  void loadFunnelState().then(() => {
    updateTotals();
    updateActiveChatUI();
    renderFunnelList();
  });

  void refreshActiveChat();

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
