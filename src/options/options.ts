import optionsTemplate from "./options.html?raw";
import { loadData, saveData } from "../shared/storage";
import { putMedia } from "../shared/mediaStore";
import type {
  Funnel,
  FunnelStep,
  IntegrationSettings,
  QuickReply,
  MediaSource,
  MediaDurationMode
} from "../shared/schema";

const FUNNEL_STORAGE_KEY = "zopFunnels";
const QUICK_REPLY_STORAGE_KEY = "zopQuickReplies";
const SETTINGS_STORAGE_KEY = "zopIntegrationSettings";
const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  enableWebhook: false,
  defaultDelaySec: 0
};

const MEDIA_STEP_TYPES = new Set<FunnelStep["type"]>(["audio", "ptt", "ptv", "image", "video", "file"]);
const DEFAULT_MEDIA_SOURCE: MediaSource = "file";
const MEDIA_FILE_ACCEPT =
  "audio/*,video/*,image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_MEDIA_DURATION_MODE: MediaDurationMode = "manual";
const DURATION_MODE_OPTIONS: MediaDurationMode[] = ["manual", "file"];
const DURATION_MODE_LABELS: Record<MediaDurationMode, string> = {
  manual: "Usar tempo manual (aleatório)",
  file: "Usar duração do arquivo"
};
const QUICK_REPLY_STAGE_KEY = "draft";

type StatusTone = "info" | "success" | "error";

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseNumber = (value: string) => {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readFileAsDataUrl = (file: File) =>
  new Promise<{ data: string; mimeType: string; fileName: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!reader.result || typeof reader.result !== "string") {
        reject(new Error("Falha ao ler arquivo"));
        return;
      }
      resolve({ data: reader.result, mimeType: file.type, fileName: file.name });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });

const estimateMediaDuration = (dataUrl: string, type: "audio" | "video") =>
  new Promise<number>((resolve) => {
    const element = document.createElement(type === "audio" ? "audio" : "video");
    element.preload = "metadata";
    const cleanup = () => {
      element.removeAttribute("src");
      element.load();
      element.remove();
    };

    const finish = () => {
      const duration = Number.isFinite(element.duration) ? Math.ceil(element.duration) : 0;
      cleanup();
      resolve(duration);
    };

    element.addEventListener("loadedmetadata", finish, { once: true });
    element.addEventListener("error", () => finish(), { once: true });
    element.src = dataUrl;
  });

const migrateMediaRecord = async (dataUrl?: string, mimeType?: string, fileName?: string) => {
  if (!dataUrl) {
    return null;
  }
  try {
    return await putMedia(dataUrl, mimeType, fileName);
  } catch (error) {
    console.error("[ZOP][MEDIA] Falha ao migrar arquivo", error);
    return null;
  }
};

const createEmptyFunnel = (): Funnel => ({
  id: createId("funnel"),
  name: "",
  description: "",
  steps: []
});

const createEmptyQuickReply = (): QuickReply => ({
  id: createId("qr"),
  title: "",
  categoryId: "",
  message: "",
  variables: [],
  mediaType: "text",
  createdAt: Date.now(),
  updatedAt: Date.now()
});

const normalizeFunnels = (raw: Funnel[]) =>
  raw.map((funnel) => ({
    ...funnel,
    steps: Array.isArray(funnel.steps)
      ? funnel.steps.map((step) => ({
          ...step,
          mediaSource: "file",
          mediaDurationMode: step.mediaDurationMode ?? DEFAULT_MEDIA_DURATION_MODE
        }))
      : []
  }));

const normalizeQuickReplies = (raw: QuickReply[]) =>
  raw.map((reply) => ({
    ...reply,
    variables: Array.isArray(reply.variables) ? reply.variables : [],
    mediaType: reply.mediaType ?? "text",
    mediaSource: "file",
    businessTags: Array.isArray(reply.businessTags) ? reply.businessTags : []
  }));

const formatMediaTypeLabel = (type?: QuickReply["mediaType"]) => {
  switch (type) {
    case "audio":
      return "Audio";
    case "ptt":
      return "PTT";
    case "ptv":
      return "PTV";
    case "image":
      return "Imagem";
    case "video":
      return "Video";
    case "file":
      return "Arquivo";
    default:
      return "Texto";
  }
};

const getQuickReplyPreview = (reply: QuickReply) => {
  const parts: string[] = [];
  if (reply.mediaType && reply.mediaType !== "text") {
    const trimmedUrl = reply.fileName ?? "Arquivo";
    parts.push(formatMediaTypeLabel(reply.mediaType));
    parts.push(trimmedUrl);
  } else {
    parts.push(reply.message?.slice(0, 40) || "Sem mensagem");
  }

  if (reply.businessTags && reply.businessTags.length > 0) {
    parts.push(`Etiquetas: ${reply.businessTags.join(", ")}`);
  }

  return parts.join(" | ");
};

const migrateFunnelsMedia = async (items: Funnel[]) => {
  let changed = false;
  for (const funnel of items) {
    for (const step of funnel.steps ?? []) {
      const stepRecord = step as FunnelStep & { mediaUrl?: string };
      step.mediaSource = "file";
      if (stepRecord.mediaUrl) {
        delete (stepRecord as Record<string, unknown>).mediaUrl;
        changed = true;
      }
      if (step.mediaFileData && !step.mediaId) {
        const mediaId = await migrateMediaRecord(step.mediaFileData, step.mediaMimeType, step.fileName);
        if (mediaId) {
          step.mediaId = mediaId;
          step.mediaFileData = undefined;
          step.mediaMimeType = undefined;
          changed = true;
        }
      }
    }
  }
  return changed;
};

const migrateQuickRepliesMedia = async (items: QuickReply[]) => {
  let changed = false;
  for (const reply of items) {
    const replyRecord = reply as QuickReply & { mediaUrl?: string };
    reply.mediaSource = "file";
    if (replyRecord.mediaUrl) {
      delete (replyRecord as Record<string, unknown>).mediaUrl;
      changed = true;
    }
    if (reply.mediaFileData && !reply.mediaId) {
      const mediaId = await migrateMediaRecord(reply.mediaFileData, reply.mediaMimeType, reply.fileName);
      if (mediaId) {
        reply.mediaId = mediaId;
        reply.mediaFileData = undefined;
        reply.mediaMimeType = undefined;
        changed = true;
      }
    }
  }
  return changed;
};



const init = async () => {
  const root = document.getElementById("zop-options-root");
  if (!root) {
    return;
  }

  root.innerHTML = optionsTemplate;

  const statusPill = root.querySelector<HTMLElement>("#zop-status");
  const setStatus = (message: string, tone: StatusTone = "info") => {
    if (!statusPill) {
      return;
    }

    statusPill.textContent = message;
    statusPill.classList.remove("status-pill--success", "status-pill--error");

    if (tone === "success") {
      statusPill.classList.add("status-pill--success");
    } else if (tone === "error") {
      statusPill.classList.add("status-pill--error");
    }
  };

  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>(".tab"));
  const panels = Array.from(root.querySelectorAll<HTMLElement>(".panel"));
  const setActivePanel = (panelId: string) => {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.panel === panelId));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === panelId));
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!tab.dataset.panel) {
        return;
      }
      setActivePanel(tab.dataset.panel);
    });
  });

  const funnelList = root.querySelector<HTMLElement>("#zop-funnel-list");
  const funnelEmpty = root.querySelector<HTMLElement>("#zop-funnel-empty");
  const funnelNameInput = root.querySelector<HTMLInputElement>("#zop-funnel-name");
  const funnelDescriptionInput = root.querySelector<HTMLTextAreaElement>("#zop-funnel-description");
  const funnelEditorTitle = root.querySelector<HTMLElement>("#zop-funnel-editor-title");
  const stepsList = root.querySelector<HTMLElement>("#zop-steps-list");
  const stepsEmpty = root.querySelector<HTMLElement>("#zop-steps-empty");
  const newFunnelButton = root.querySelector<HTMLButtonElement>("#zop-new-funnel");
  const saveFunnelButton = root.querySelector<HTMLButtonElement>("#zop-save-funnel");
  const deleteFunnelButton = root.querySelector<HTMLButtonElement>("#zop-delete-funnel");
  const addStepButton = root.querySelector<HTMLButtonElement>("#zop-add-step");

  const quickReplyList = root.querySelector<HTMLElement>("#zop-quickreply-list");
  const quickReplyEmpty = root.querySelector<HTMLElement>("#zop-quickreply-empty");
  const quickReplyCategoryInput = root.querySelector<HTMLInputElement>("#zop-quickreply-category");
  const quickReplyTitleInput = root.querySelector<HTMLInputElement>("#zop-quickreply-title");
  const quickReplyMessageInput = root.querySelector<HTMLTextAreaElement>("#zop-quickreply-message");
  const quickReplyVariablesInput = root.querySelector<HTMLInputElement>("#zop-quickreply-variables");
  const quickReplyTypeInput = root.querySelector<HTMLSelectElement>("#zop-quickreply-type");
  const quickReplyMediaCaptionInput = root.querySelector<HTMLInputElement>("#zop-quickreply-media-caption");
  const quickReplyFileNameInput = root.querySelector<HTMLInputElement>("#zop-quickreply-file-name");
  const quickReplyMediaSection = root.querySelector<HTMLElement>("#zop-quickreply-media");
  const quickReplyMediaFileInput = root.querySelector<HTMLInputElement>("#zop-quickreply-media-file");
  const quickReplyMediaFileLabel = root.querySelector<HTMLElement>("#zop-quickreply-media-file-label");
  const quickReplyBusinessTagsInput = root.querySelector<HTMLInputElement>("#zop-quickreply-business-tags");
  const quickReplyEditorTitle = root.querySelector<HTMLElement>("#zop-quickreply-editor-title");
  const newQuickReplyButton = root.querySelector<HTMLButtonElement>("#zop-new-quickreply");
  const saveQuickReplyButton = root.querySelector<HTMLButtonElement>("#zop-save-quickreply");
  const deleteQuickReplyButton = root.querySelector<HTMLButtonElement>("#zop-delete-quickreply");

  const n8nUrlInput = root.querySelector<HTMLInputElement>("#zop-n8n-url");
  const n8nSecretInput = root.querySelector<HTMLInputElement>("#zop-n8n-secret");
  const enableWebhookInput = root.querySelector<HTMLInputElement>("#zop-enable-webhook");
  const saveIntegrationsButton = root.querySelector<HTMLButtonElement>("#zop-save-integrations");

  const exportBackupButton = root.querySelector<HTMLButtonElement>("#zop-export-backup");
  const importBackupTrigger = root.querySelector<HTMLButtonElement>("#zop-import-backup-trigger");
  const importBackupInput = root.querySelector<HTMLInputElement>("#zop-import-backup");

  let funnels: Funnel[] = [];
  let quickReplies: QuickReply[] = [];
  let integrationSettings: IntegrationSettings = DEFAULT_INTEGRATION_SETTINGS;
  let activeFunnel = createEmptyFunnel();
  let activeQuickReplyId: string | null = null;
  const payloadDrafts = new Map<string, string>();
  const quickReplyMediaCache = new Map<string, { mediaId?: string; fileName?: string }>();
  const pendingMediaUploads = new Map<string, Promise<void>>();
  let draggedStepId: string | null = null;
  let dropTargetElement: HTMLElement | null = null;

  const clearDropState = () => {
    if (dropTargetElement) {
      dropTargetElement.classList.remove("step--drop-target");
      dropTargetElement = null;
    }
  };

  const moveStep = (fromId: string, toId: string) => {
    const fromIndex = activeFunnel.steps.findIndex((item) => item.id === fromId);
    const toIndex = activeFunnel.steps.findIndex((item) => item.id === toId);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [step] = activeFunnel.steps.splice(fromIndex, 1);
    activeFunnel.steps.splice(toIndex, 0, step);
    renderSteps();
  };

  const updateStepFileLabel = (element: HTMLElement, name?: string) => {
    const label = element.querySelector<HTMLElement>("[data-field='mediaFileLabel']");
    if (label) {
      label.textContent = name ? `Arquivo: ${name}` : "Nenhum arquivo selecionado";
    }
  };
  const updateStepDurationHint = (
    element: HTMLElement,
    step: FunnelStep,
    mode: MediaDurationMode
  ) => {
    const hint = element.querySelector<HTMLElement>("[data-field='mediaDurationHint']") ?? element;
    if (!hint) {
      return;
    }
    if (mode === "file" && typeof step.mediaDurationSec === "number" && step.mediaDurationSec > 0) {
      hint.textContent = `Usando duração do arquivo: ${step.mediaDurationSec}s`;
    } else {
      hint.textContent = "Tempo automático (5-10s) será utilizado";
    }
  };
  const getQuickReplyMediaStageKey = () => activeQuickReplyId ?? QUICK_REPLY_STAGE_KEY;
  const ensureQuickReplyMediaStage = () => {
    const key = getQuickReplyMediaStageKey();
    if (!quickReplyMediaCache.has(key)) {
      quickReplyMediaCache.set(key, {});
    }
    return quickReplyMediaCache.get(key)!;
  };

  const updateQuickReplyMediaPreview = () => {
    if (!quickReplyMediaFileLabel) {
      return;
    }
    const stage = ensureQuickReplyMediaStage();
    quickReplyMediaFileLabel.textContent = stage.fileName
      ? `Arquivo: ${stage.fileName}`
      : "Nenhum arquivo selecionado";
  };

  const updateQuickReplyMediaVisibility = () => {
    const hasMedia = (quickReplyTypeInput?.value ?? "text") !== "text";
    if (quickReplyMediaSection) {
      quickReplyMediaSection.classList.toggle("is-active", hasMedia);
      quickReplyMediaSection.dataset.source = "file";
    }
  };

  const updateFunnelEditorTitle = () => {
    if (!funnelEditorTitle) {
      return;
    }
    const label = activeFunnel.name?.trim();
    funnelEditorTitle.textContent = label ? `Editando: ${label}` : "Novo funil";
  };

  const updateQuickReplyEditorTitle = () => {
    if (!quickReplyEditorTitle) {
      return;
    }
    const reply = quickReplies.find((item) => item.id === activeQuickReplyId);
    const label = reply?.title?.trim() || quickReplyTitleInput?.value.trim();
    quickReplyEditorTitle.textContent = label ? `Editando: ${label}` : "Nova resposta";
  };

  const renderFunnelList = () => {
    if (!funnelList || !funnelEmpty) {
      return;
    }

    funnelList.innerHTML = "";
    funnelEmpty.style.display = funnels.length === 0 ? "block" : "none";

    funnels.forEach((funnel) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "list-item";
      button.classList.toggle("is-active", funnel.id === activeFunnel.id);

      const info = document.createElement("div");
      info.className = "list-item__info";

      const title = document.createElement("div");
      title.className = "list-item__title";
      title.textContent = funnel.name?.trim() || "Funil sem nome";

      const subtitle = document.createElement("div");
      subtitle.className = "list-item__meta";
      subtitle.textContent = funnel.description?.trim() || "Sem descricao";

      info.append(title, subtitle);

      const stepsMeta = document.createElement("div");
      stepsMeta.className = "list-item__meta";
      stepsMeta.textContent = `${funnel.steps?.length ?? 0} etapas`;

      button.append(info, stepsMeta);
      button.addEventListener("click", () => {
        setActiveFunnel(funnel);
      });

      funnelList.appendChild(button);
    });
  };

  const renderSteps = () => {
    if (!stepsList || !stepsEmpty) {
      return;
    }

    stepsList.innerHTML = "";
    stepsEmpty.style.display = activeFunnel.steps.length === 0 ? "block" : "none";

    activeFunnel.steps.forEach((step, index) => {
      const stepElement = document.createElement("article");
      stepElement.className = "step";
      stepElement.dataset.stepId = step.id;
      stepElement.dataset.stepType = step.type;
      stepElement.dataset.mediaSource = "file";
      stepElement.draggable = true;
      stepElement.addEventListener("dragstart", () => {
        draggedStepId = step.id;
        stepElement.classList.add("is-dragging");
        clearDropState();
      });
      stepElement.addEventListener("dragend", () => {
        draggedStepId = null;
        stepElement.classList.remove("is-dragging");
        clearDropState();
      });
      stepElement.addEventListener("dragover", (event) => {
        if (draggedStepId === step.id) {
          return;
        }
        event.preventDefault();
        if (dropTargetElement && dropTargetElement !== stepElement) {
          dropTargetElement.classList.remove("step--drop-target");
        }
        dropTargetElement = stepElement;
        dropTargetElement.classList.add("step--drop-target");
      });
      stepElement.addEventListener("dragleave", () => {
        if (dropTargetElement === stepElement) {
          clearDropState();
        }
      });
      stepElement.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!draggedStepId) {
          return;
        }
        clearDropState();
        moveStep(draggedStepId, step.id);
      });
      stepElement.innerHTML = `
        <div class="step__header">
          <div class="step__meta">
            <span class="step__index">Etapa ${index + 1}</span>
            <select class="input input--small" data-field="type">
              <option value="text">Texto</option>
              <option value="audio">Audio</option>
              <option value="ptt">PTT (gravado)</option>
              <option value="ptv">PTV (video recado)</option>
              <option value="image">Imagem</option>
              <option value="video">Video</option>
              <option value="file">Arquivo</option>
              <option value="delay">Delay</option>
              <option value="tag">Tags</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <span class="step__drag-handle" aria-label="Arrastar etapa" title="Arrastar">&#9776;</span>
          <div class="step__actions">
            <button class="icon-button" type="button" data-action="move-up" aria-label="Mover para cima">
              Up
            </button>
            <button class="icon-button" type="button" data-action="move-down" aria-label="Mover para baixo">
              Down
            </button>
            <button class="icon-button" type="button" data-action="delete" aria-label="Remover etapa">
              X
            </button>
          </div>
        </div>
        <div class="step__group" data-group="text">
          <label class="field">
            <span>Mensagem</span>
            <textarea class="input input--area" data-field="text" rows="3"></textarea>
          </label>
        </div>
        <div class="step__group" data-group="delay">
          <div class="field-grid">
            <label class="field">
              <span>Delay (segundos, opcional)</span>
              <input class="input" data-field="delaySec" type="number" min="0" placeholder="Ex: 45" />
            </label>
            <label class="field">
              <span>Expressao</span>
              <input class="input" data-field="delayExpr" type="text" placeholder="Ex: rand(5,10)" />
            </label>
          </div>
        </div>
        <div class="step__group" data-group="tag">
          <label class="field">
            <span>Tags (separe por virgula)</span>
            <input class="input" data-field="tags" type="text" placeholder="Ex: lead, teste" />
          </label>
        </div>
        <div class="step__group" data-group="webhook">
          <label class="field">
            <span>Evento</span>
            <input class="input" data-field="webhookEvent" type="text" placeholder="Ex: etapa" />
          </label>
          <label class="field">
            <span>Payload (JSON)</span>
            <textarea
              class="input input--area"
              data-field="payloadTemplate"
              rows="4"
              placeholder='{"leadId": "{{lead.id}}"}'
            ></textarea>
          </label>
        </div>
        <div class="step__group" data-group="media">
          <label class="field media__field media__field--file">
            <span>Upload (mp3, mp4, png, pdf, docx)</span>
            <input
              class="input"
              data-field="mediaFile"
              type="file"
              accept="${MEDIA_FILE_ACCEPT}"
            />
            <span class="media__file-label" data-field="mediaFileLabel">Nenhum arquivo selecionado</span>
          </label>
          <label class="field">
            <span>Legenda (opcional)</span>
            <input class="input" data-field="mediaCaption" type="text" placeholder="Texto da legenda" />
          </label>
          <label class="field">
            <span>Nome do arquivo (ex: documento.pdf)</span>
            <input class="input" data-field="fileName" type="text" placeholder="documento.pdf" />
          </label>
          <div class="field-grid media-duration">
            <label class="field">
              <span>Duração do envio</span>
              <select class="input input--small" data-field="mediaDurationMode">
                <option value="manual">Manual (aleatório)</option>
                <option value="file">Usar duração do arquivo</option>
              </select>
            </label>
            <div class="media-duration__hint" data-field="mediaDurationHint">Tempo automático (5-10s) será utilizado</div>
          </div>
        </div>
      `;

      const typeSelect = stepElement.querySelector<HTMLSelectElement>("select[data-field='type']");
      if (typeSelect) {
        typeSelect.value = step.type;
      }
      stepElement.dataset.mediaSource = "file";

      const textArea = stepElement.querySelector<HTMLTextAreaElement>("textarea[data-field='text']");
      if (textArea) {
        textArea.value = step.text ?? "";
      }

      const delaySecInput = stepElement.querySelector<HTMLInputElement>("input[data-field='delaySec']");
      if (delaySecInput) {
        delaySecInput.value = Number.isFinite(step.delaySec) ? String(step.delaySec) : "";
      }

      const delayExprInput = stepElement.querySelector<HTMLInputElement>("input[data-field='delayExpr']");
      if (delayExprInput) {
        delayExprInput.value = step.delayExpr ?? "";
      }

      const tagsInput = stepElement.querySelector<HTMLInputElement>("input[data-field='tags']");
      if (tagsInput) {
        tagsInput.value = step.addTags?.join(", ") ?? "";
      }

      const webhookEventInput = stepElement.querySelector<HTMLInputElement>("input[data-field='webhookEvent']");
      if (webhookEventInput) {
        webhookEventInput.value = step.webhookEvent ?? "";
      }

      const payloadInput = stepElement.querySelector<HTMLTextAreaElement>("textarea[data-field='payloadTemplate']");
      if (payloadInput) {
        const payloadText =
          payloadDrafts.get(step.id) ??
          (step.payloadTemplate ? JSON.stringify(step.payloadTemplate, null, 2) : "");
        payloadDrafts.set(step.id, payloadText);
        payloadInput.value = payloadText;
      }


      const mediaCaptionInput = stepElement.querySelector<HTMLInputElement>("input[data-field='mediaCaption']");
      if (mediaCaptionInput) {
        mediaCaptionInput.value = step.mediaCaption ?? "";
      }

      const fileNameInput = stepElement.querySelector<HTMLInputElement>("input[data-field='fileName']");
      if (fileNameInput) {
        fileNameInput.value = step.fileName ?? "";
      }
      updateStepFileLabel(stepElement, step.fileName);
      const durationModeSelect = stepElement.querySelector<HTMLSelectElement>(
        "select[data-field='mediaDurationMode']"
      );
      const resolvedDurationMode = step.mediaDurationMode ?? DEFAULT_MEDIA_DURATION_MODE;
      if (durationModeSelect) {
        durationModeSelect.value = resolvedDurationMode;
      }
      stepElement.dataset.mediaDurationMode = resolvedDurationMode;
      updateStepDurationHint(stepElement, step, resolvedDurationMode);

      const moveUp = stepElement.querySelector<HTMLButtonElement>("button[data-action='move-up']");
      if (moveUp) {
        moveUp.disabled = index === 0;
      }

      const moveDown = stepElement.querySelector<HTMLButtonElement>("button[data-action='move-down']");
      if (moveDown) {
        moveDown.disabled = index === activeFunnel.steps.length - 1;
      }

      stepsList.appendChild(stepElement);
    });

    renderFunnelList();
  };

  const setActiveFunnel = (funnel: Funnel) => {
    activeFunnel = clone(funnel);
    payloadDrafts.clear();

    if (funnelNameInput) {
      funnelNameInput.value = activeFunnel.name ?? "";
    }
    if (funnelDescriptionInput) {
      funnelDescriptionInput.value = activeFunnel.description ?? "";
    }
    if (deleteFunnelButton) {
      deleteFunnelButton.disabled = !funnels.some((item) => item.id === activeFunnel.id);
    }

    updateFunnelEditorTitle();
    renderSteps();
  };

  const setActiveQuickReply = (reply: QuickReply | null) => {
    activeQuickReplyId = reply?.id ?? null;

    if (reply) {
      quickReplyMediaCache.set(reply.id, {
        mediaId: reply.mediaId,
        fileName: reply.fileName
      });
    } else {
      quickReplyMediaCache.set(QUICK_REPLY_STAGE_KEY, {});
    }

    if (quickReplyCategoryInput) {
      quickReplyCategoryInput.value = reply?.categoryId ?? "";
    }
    if (quickReplyTitleInput) {
      quickReplyTitleInput.value = reply?.title ?? "";
    }
    if (quickReplyTypeInput) {
      quickReplyTypeInput.value = reply?.mediaType ?? "text";
    }
    if (quickReplyMessageInput) {
      quickReplyMessageInput.value = reply?.message ?? "";
    }
    if (quickReplyVariablesInput) {
      quickReplyVariablesInput.value = reply?.variables?.join(", ") ?? "";
    }
    if (quickReplyMediaCaptionInput) {
      quickReplyMediaCaptionInput.value = reply?.mediaCaption ?? "";
    }
    if (quickReplyBusinessTagsInput) {
      quickReplyBusinessTagsInput.value = reply?.businessTags?.join(", ") ?? "";
    }

    const stage = ensureQuickReplyMediaStage();
    if (reply) {
      stage.mediaId = stage.mediaId ?? reply.mediaId ?? undefined;
      stage.fileName = stage.fileName ?? reply.fileName ?? "";
    } else {
      stage.mediaId = undefined;
      stage.fileName = undefined;
    }

    if (quickReplyFileNameInput) {
      quickReplyFileNameInput.value = stage.fileName ?? reply?.fileName ?? "";
    }

    updateQuickReplyMediaPreview();
    updateQuickReplyMediaVisibility();

    if (deleteQuickReplyButton) {
      deleteQuickReplyButton.disabled = !reply;
    }
    updateQuickReplyEditorTitle();
  };

  const renderQuickReplyList = () => {
    if (!quickReplyList || !quickReplyEmpty) {
      return;
    }

    quickReplyList.innerHTML = "";
    quickReplyEmpty.style.display = quickReplies.length === 0 ? "block" : "none";

    quickReplies.forEach((reply) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "list-item";
      button.classList.toggle("is-active", reply.id === activeQuickReplyId);

      const info = document.createElement("div");
      info.className = "list-item__info";

      const title = document.createElement("div");
      title.className = "list-item__title";
      title.textContent = reply.title || "Sem titulo";

      const subtitle = document.createElement("div");
      subtitle.className = "list-item__meta";
      subtitle.textContent = reply.categoryId || "Sem categoria";

      info.append(title, subtitle);

      const preview = document.createElement("div");
      preview.className = "list-item__meta";
      preview.textContent = getQuickReplyPreview(reply);

      const badge = document.createElement("span");
      badge.className = "list-item__badge";
      badge.textContent = formatMediaTypeLabel(reply.mediaType);

      button.append(info, preview, badge);
      button.addEventListener("click", () => {
        setActiveQuickReply(reply);
        renderQuickReplyList();
      });

      quickReplyList.appendChild(button);
    });
  };

  const applyIntegrationSettings = (settings: IntegrationSettings) => {
    if (n8nUrlInput) {
      n8nUrlInput.value = settings.n8nWebhookUrl ?? "";
    }
    if (n8nSecretInput) {
      n8nSecretInput.value = settings.n8nSecret ?? "";
    }
    if (enableWebhookInput) {
      enableWebhookInput.checked = Boolean(settings.enableWebhook);
    }
  };

  const clearStepErrors = () => {
    if (!stepsList) {
      return;
    }
    stepsList.querySelectorAll(".step--error").forEach((element) => {
      element.classList.remove("step--error");
    });
  };

  const buildFunnelForSave = (): Funnel | null => {
    clearStepErrors();

    const name = activeFunnel.name.trim();
    if (!name) {
      setStatus("Informe um nome para o funil.", "error");
      return null;
    }

    let invalidStepId: string | null = null;
    let invalidReason: "payload" | "media" | null = null;

    const normalizedSteps: FunnelStep[] = activeFunnel.steps.map((step) => {
      const tags = (step.addTags ?? []).map((tag) => tag.trim()).filter(Boolean);
      const next: FunnelStep = {
        ...step,
        text: step.text?.trim() || undefined,
        delaySec: Number.isFinite(step.delaySec) ? step.delaySec : undefined,
        delayExpr: step.delayExpr?.trim() || undefined,
        addTags: tags.length ? tags : undefined,
        webhookEvent: step.webhookEvent?.trim() || undefined,
        payloadTemplate: undefined,
        mediaSource: "file",
        mediaCaption: step.mediaCaption?.trim() || undefined,
        fileName: step.fileName?.trim() || undefined,
        mediaId: step.mediaId,
        mediaFileData: undefined,
        mediaMimeType: undefined,
        mediaDurationMode: step.mediaDurationMode,
        mediaDurationSec: step.mediaDurationSec
      };

      if (MEDIA_STEP_TYPES.has(step.type) && !next.mediaId) {
        invalidStepId = step.id;
        invalidReason = "media";
      }

      if (step.type === "webhook") {
        const raw = payloadDrafts.get(step.id);
        if (raw && raw.trim()) {
          try {
            next.payloadTemplate = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            invalidStepId = step.id;
            invalidReason = "payload";
          }
        }
      }

      return next;
    });

    if (invalidStepId) {
      const stepElement = stepsList?.querySelector<HTMLElement>(`[data-step-id="${invalidStepId}"]`);
      stepElement?.classList.add("step--error");
      if (invalidReason === "media") {
        setStatus("Selecione um arquivo para a etapa de midia.", "error");
      } else {
        setStatus("Payload JSON invalido na etapa selecionada.", "error");
      }
      return null;
    }

    return {
      ...activeFunnel,
      name,
      description: activeFunnel.description?.trim() || undefined,
      steps: normalizedSteps
    };
  };

  const saveFunnels = async () => {
    if (pendingMediaUploads.size > 0) {
      await Promise.all(Array.from(pendingMediaUploads.values()));
    }

    const prepared = buildFunnelForSave();
    if (!prepared) {
      return;
    }

    const index = funnels.findIndex((item) => item.id === prepared.id);
    if (index >= 0) {
      funnels[index] = prepared;
    } else {
      funnels = [...funnels, prepared];
    }

    await saveData(FUNNEL_STORAGE_KEY, funnels);
    setActiveFunnel(prepared);
    setStatus("Funil salvo.", "success");
  };

  const deleteFunnel = async () => {
    if (!deleteFunnelButton || deleteFunnelButton.disabled) {
      return;
    }

    const confirmed = window.confirm("Excluir este funil?");
    if (!confirmed) {
      return;
    }

    funnels = funnels.filter((item) => item.id !== activeFunnel.id);
    await saveData(FUNNEL_STORAGE_KEY, funnels);
    setActiveFunnel(funnels[0] ?? createEmptyFunnel());
    setStatus("Funil removido.", "success");
  };

  const saveQuickReply = async () => {
    if (!quickReplyTitleInput || !quickReplyMessageInput || !quickReplyCategoryInput) {
      return;
    }

    const quickReplyStageKey = `qr:${getQuickReplyMediaStageKey()}`;
    const pendingQuickReply = pendingMediaUploads.get(quickReplyStageKey);
    if (pendingQuickReply) {
      await pendingQuickReply;
    }

    const title = quickReplyTitleInput.value.trim();
    const message = quickReplyMessageInput.value.trim();
    if (!title || !message) {
      setStatus("Informe titulo e mensagem da resposta.", "error");
      return;
    }

    const category = quickReplyCategoryInput.value.trim() || "Sem categoria";
    const variables = quickReplyVariablesInput ? parseList(quickReplyVariablesInput.value) : [];
    const mediaType = (quickReplyTypeInput?.value as QuickReply["mediaType"]) ?? "text";
    const stage = ensureQuickReplyMediaStage();
    const mediaCaption = quickReplyMediaCaptionInput?.value.trim() || undefined;
    const fileName = quickReplyFileNameInput?.value.trim() || stage.fileName || undefined;
    const mediaId = stage.mediaId;
    const businessTags = parseList(quickReplyBusinessTagsInput?.value ?? "");
    const now = Date.now();

    if (mediaType !== "text" && !mediaId) {
      setStatus("Selecione um arquivo para a resposta rapida.", "error");
      return;
    }

    const existingIndex = activeQuickReplyId
      ? quickReplies.findIndex((item) => item.id === activeQuickReplyId)
      : -1;

    let saved: QuickReply;
    const sharedFields: Partial<QuickReply> = {
      title,
      categoryId: category,
      message,
      variables,
      mediaType,
      mediaSource: "file",
      mediaCaption,
      fileName,
      mediaId,
      businessTags: businessTags.length ? businessTags : undefined,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      saved = {
        ...quickReplies[existingIndex],
        ...sharedFields
      };
      quickReplies[existingIndex] = saved;
    } else {
      saved = {
        id: createId("qr"),
        createdAt: now,
        ...sharedFields
      };
      quickReplies = [...quickReplies, saved];
    }

    quickReplyMediaCache.set(saved.id, {
      mediaId,
      fileName
    });
    quickReplyMediaCache.delete(QUICK_REPLY_STAGE_KEY);

    await saveData(QUICK_REPLY_STORAGE_KEY, quickReplies);
    setActiveQuickReply(saved);
    renderQuickReplyList();
    setStatus("Resposta salva.", "success");
  };

  const deleteQuickReply = async () => {
    if (!activeQuickReplyId) {
      return;
    }

    const confirmed = window.confirm("Excluir esta resposta?");
    if (!confirmed) {
      return;
    }

    quickReplies = quickReplies.filter((item) => item.id !== activeQuickReplyId);
    await saveData(QUICK_REPLY_STORAGE_KEY, quickReplies);
    setActiveQuickReply(quickReplies[0] ?? null);
    renderQuickReplyList();
    setStatus("Resposta removida.", "success");
  };

  const saveIntegrations = async () => {
    const next: IntegrationSettings = {
      ...DEFAULT_INTEGRATION_SETTINGS,
      ...integrationSettings,
      enableWebhook: Boolean(enableWebhookInput?.checked),
      n8nWebhookUrl: n8nUrlInput?.value.trim() || undefined,
      n8nSecret: n8nSecretInput?.value.trim() || undefined
    };

    integrationSettings = next;
    await saveData(SETTINGS_STORAGE_KEY, next);
    setStatus("Integracoes salvas.", "success");
  };

  const exportBackup = async () => {
    const [storedFunnels, storedReplies, storedSettings] = await Promise.all([
      loadData<Funnel[]>(FUNNEL_STORAGE_KEY, []),
      loadData<QuickReply[]>(QUICK_REPLY_STORAGE_KEY, []),
      loadData<IntegrationSettings>(SETTINGS_STORAGE_KEY, DEFAULT_INTEGRATION_SETTINGS)
    ]);

    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      funnels: Array.isArray(storedFunnels) ? storedFunnels : [],
      quickReplies: Array.isArray(storedReplies) ? storedReplies : [],
      integrationSettings: {
        ...DEFAULT_INTEGRATION_SETTINGS,
        ...(storedSettings ?? {})
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zaporganic-backup-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Backup exportado.", "success");
  };

  const importBackup = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text()) as unknown;
    } catch {
      setStatus("Arquivo JSON invalido.", "error");
      return;
    }

    const record = (parsed ?? {}) as Record<string, unknown>;
    const nextFunnelsRaw = Array.isArray(record.funnels)
      ? (record.funnels as Funnel[])
      : Array.isArray(record[FUNNEL_STORAGE_KEY])
        ? (record[FUNNEL_STORAGE_KEY] as Funnel[])
        : [];
    const nextFunnels = normalizeFunnels(nextFunnelsRaw);
    const nextRepliesRaw = Array.isArray(record.quickReplies)
      ? (record.quickReplies as QuickReply[])
      : Array.isArray(record[QUICK_REPLY_STORAGE_KEY])
        ? (record[QUICK_REPLY_STORAGE_KEY] as QuickReply[])
        : [];
    const nextReplies = normalizeQuickReplies(nextRepliesRaw);
    const settingsRaw =
      (record.integrationSettings as IntegrationSettings | undefined) ||
      (record[SETTINGS_STORAGE_KEY] as IntegrationSettings | undefined) ||
      {};
    const nextSettings: IntegrationSettings = {
      ...DEFAULT_INTEGRATION_SETTINGS,
      ...(settingsRaw ?? {})
    };

    await migrateFunnelsMedia(nextFunnels);
    await migrateQuickRepliesMedia(nextReplies);

    await Promise.all([
      saveData(FUNNEL_STORAGE_KEY, nextFunnels),
      saveData(QUICK_REPLY_STORAGE_KEY, nextReplies),
      saveData(SETTINGS_STORAGE_KEY, nextSettings)
    ]);

    funnels = nextFunnels;
    quickReplies = nextReplies;
    integrationSettings = nextSettings;
    setActiveFunnel(funnels[0] ?? createEmptyFunnel());
    setActiveQuickReply(quickReplies[0] ?? null);
    renderQuickReplyList();
    applyIntegrationSettings(integrationSettings);
    setStatus("Backup importado.", "success");
  };

  const addStep = () => {
    activeFunnel.steps.push({
      id: createId("step"),
      type: "text",
      text: "",
      mediaSource: DEFAULT_MEDIA_SOURCE
    });
    renderSteps();
  };

  funnelNameInput?.addEventListener("input", (event) => {
    activeFunnel.name = (event.target as HTMLInputElement).value;
    updateFunnelEditorTitle();
    renderFunnelList();
  });

  funnelDescriptionInput?.addEventListener("input", (event) => {
    activeFunnel.description = (event.target as HTMLTextAreaElement).value;
    renderFunnelList();
  });

  stepsList?.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    const field = target.getAttribute("data-field");
    if (!field) {
      return;
    }

    const stepElement = target.closest<HTMLElement>("[data-step-id]");
    if (!stepElement?.dataset.stepId) {
      return;
    }

    const step = activeFunnel.steps.find((item) => item.id === stepElement.dataset.stepId);
    if (!step) {
      return;
    }

    if (field === "text") {
      step.text = (target as HTMLTextAreaElement).value;
    } else if (field === "delaySec") {
      step.delaySec = parseNumber((target as HTMLInputElement).value);
    } else if (field === "delayExpr") {
      step.delayExpr = (target as HTMLInputElement).value;
    } else if (field === "tags") {
      step.addTags = parseList((target as HTMLInputElement).value);
    } else if (field === "webhookEvent") {
      step.webhookEvent = (target as HTMLInputElement).value;
    } else if (field === "payloadTemplate") {
      payloadDrafts.set(step.id, (target as HTMLTextAreaElement).value);
    } else if (field === "mediaCaption") {
      step.mediaCaption = (target as HTMLInputElement).value;
    } else if (field === "fileName") {
      step.fileName = (target as HTMLInputElement).value;
    }
  });

  stepsList?.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    const field = target.getAttribute("data-field");
    if (!field) {
      return;
    }

    const stepElement = target.closest<HTMLElement>("[data-step-id]");
    if (!stepElement?.dataset.stepId) {
      return;
    }

    const step = activeFunnel.steps.find((item) => item.id === stepElement.dataset.stepId);
    if (!step) {
      return;
    }

    if (field === "type") {
      step.type = (target as HTMLSelectElement).value as FunnelStep["type"];
      stepElement.dataset.stepType = step.type;
      return;
    }

    if (field === "mediaDurationMode") {
      const value = (target as HTMLSelectElement).value as MediaDurationMode;
      step.mediaDurationMode = value;
      stepElement.dataset.mediaDurationMode = value;
      updateStepDurationHint(stepElement, step, value);
      return;
    }

    if (field === "mediaFile") {
      const fileInput = target as HTMLInputElement;
      const file = fileInput.files?.[0];
      if (!file) {
        step.mediaId = undefined;
        step.mediaFileData = undefined;
        step.mediaMimeType = undefined;
        step.fileName = undefined;
        step.mediaDurationSec = undefined;
        updateStepFileLabel(stepElement, undefined);
        updateStepDurationHint(stepElement, step, step.mediaDurationMode ?? DEFAULT_MEDIA_DURATION_MODE);
        return;
      }

      step.fileName = file.name;
      const fileLabel = stepElement.querySelector<HTMLElement>("[data-field='mediaFileLabel']");
      if (fileLabel) {
        fileLabel.textContent = `Arquivo: ${file.name}`;
      }

      const uploadKey = `step:${step.id}`;
      const uploadPromise = readFileAsDataUrl(file)
        .then(async (result) => {
          const mediaId = await putMedia(result.data, result.mimeType, result.fileName);
          step.mediaId = mediaId;
          step.mediaFileData = undefined;
          step.mediaMimeType = undefined;
          step.fileName = step.fileName ?? result.fileName;
          updateStepFileLabel(stepElement, step.fileName);

          if (["audio", "ptt", "ptv", "video"].includes(step.type)) {
            const kind = step.type === "video" || step.type === "ptv" ? "video" : "audio";
            const duration = await estimateMediaDuration(result.data, kind);
            step.mediaDurationSec = duration || undefined;
            updateStepDurationHint(stepElement, step, step.mediaDurationMode ?? DEFAULT_MEDIA_DURATION_MODE);
          }
        })
        .catch((error) => {
          console.error("[ZOP][MEDIA] Falha ao salvar arquivo", error);
          setStatus("Falha ao salvar arquivo no banco local.", "error");
        })
        .finally(() => {
          pendingMediaUploads.delete(uploadKey);
        });

      pendingMediaUploads.set(uploadKey, uploadPromise);
      return;
    }
  });

  stepsList?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
    if (!button) {
      return;
    }

    const stepElement = button.closest<HTMLElement>("[data-step-id]");
    if (!stepElement?.dataset.stepId) {
      return;
    }

    const index = activeFunnel.steps.findIndex((item) => item.id === stepElement.dataset.stepId);
    if (index === -1) {
      return;
    }

    const action = button.dataset.action;
    if (action === "delete") {
      payloadDrafts.delete(stepElement.dataset.stepId);
      activeFunnel.steps.splice(index, 1);
      renderSteps();
    } else if (action === "move-up" && index > 0) {
      const [step] = activeFunnel.steps.splice(index, 1);
      activeFunnel.steps.splice(index - 1, 0, step);
      renderSteps();
    } else if (action === "move-down" && index < activeFunnel.steps.length - 1) {
      const [step] = activeFunnel.steps.splice(index, 1);
      activeFunnel.steps.splice(index + 1, 0, step);
      renderSteps();
    }
  });

  newFunnelButton?.addEventListener("click", () => {
    setActiveFunnel(createEmptyFunnel());
  });
  addStepButton?.addEventListener("click", addStep);
  saveFunnelButton?.addEventListener("click", () => void saveFunnels());
  deleteFunnelButton?.addEventListener("click", () => void deleteFunnel());

  quickReplyTitleInput?.addEventListener("input", () => {
    updateQuickReplyEditorTitle();
  });
  newQuickReplyButton?.addEventListener("click", () => {
    setActiveQuickReply(null);
    renderQuickReplyList();
  });
  saveQuickReplyButton?.addEventListener("click", () => void saveQuickReply());
  deleteQuickReplyButton?.addEventListener("click", () => void deleteQuickReply());
  quickReplyTypeInput?.addEventListener("change", () => {
    updateQuickReplyMediaVisibility();
  });
  quickReplyMediaFileInput?.addEventListener("change", () => {
    const file = quickReplyMediaFileInput.files?.[0];
    const stage = ensureQuickReplyMediaStage();
    if (!file) {
      stage.mediaId = undefined;
      stage.fileName = undefined;
      updateQuickReplyMediaPreview();
      return;
    }
    const uploadKey = `qr:${getQuickReplyMediaStageKey()}`;
    const uploadPromise = readFileAsDataUrl(file)
      .then(async (fileData) => {
        const mediaId = await putMedia(fileData.data, fileData.mimeType, fileData.fileName);
        stage.mediaId = mediaId;
        stage.fileName = fileData.fileName;
        if (quickReplyFileNameInput) {
          quickReplyFileNameInput.value = fileData.fileName;
        }
        updateQuickReplyMediaPreview();
      })
      .catch((error) => {
        console.error("[ZOP][MEDIA] Falha ao salvar arquivo", error);
        setStatus("Falha ao salvar arquivo no banco local.", "error");
      })
      .finally(() => {
        pendingMediaUploads.delete(uploadKey);
      });
    pendingMediaUploads.set(uploadKey, uploadPromise);
  });
  quickReplyFileNameInput?.addEventListener("input", () => {
    ensureQuickReplyMediaStage().fileName = quickReplyFileNameInput.value.trim() || undefined;
    updateQuickReplyMediaPreview();
  });

  saveIntegrationsButton?.addEventListener("click", () => void saveIntegrations());

  exportBackupButton?.addEventListener("click", () => void exportBackup());
  importBackupTrigger?.addEventListener("click", () => {
    importBackupInput?.click();
  });
  importBackupInput?.addEventListener("change", () => {
    const file = importBackupInput.files?.[0];
    if (!file) {
      return;
    }
    void importBackup(file);
    importBackupInput.value = "";
  });

  const [storedFunnels, storedReplies, storedSettings] = await Promise.all([
    loadData<Funnel[]>(FUNNEL_STORAGE_KEY, []),
    loadData<QuickReply[]>(QUICK_REPLY_STORAGE_KEY, []),
    loadData<IntegrationSettings>(SETTINGS_STORAGE_KEY, DEFAULT_INTEGRATION_SETTINGS)
  ]);

  funnels = Array.isArray(storedFunnels) ? normalizeFunnels(storedFunnels) : [];
  quickReplies = Array.isArray(storedReplies) ? normalizeQuickReplies(storedReplies) : [];
  integrationSettings = {
    ...DEFAULT_INTEGRATION_SETTINGS,
    ...(storedSettings ?? {})
  };

  const migratedFunnels = await migrateFunnelsMedia(funnels);
  const migratedReplies = await migrateQuickRepliesMedia(quickReplies);
  if (migratedFunnels || migratedReplies) {
    await Promise.all([
      saveData(FUNNEL_STORAGE_KEY, funnels),
      saveData(QUICK_REPLY_STORAGE_KEY, quickReplies)
    ]);
  }

  setActiveFunnel(funnels[0] ?? createEmptyFunnel());
  setActiveQuickReply(quickReplies[0] ?? null);
  renderQuickReplyList();
  applyIntegrationSettings(integrationSettings);
  setStatus("Pronto", "success");
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void init(), { once: true });
} else {
  void init();
}
