import { resolveDelaySec } from "../shared/delay";
import { loadData, saveData } from "../shared/storage";
import { getMedia } from "../shared/mediaStore";
import type { Funnel, FunnelStep, IntegrationSettings, LeadCard } from "../shared/schema";

const LOG_PREFIX = "[ZOP][FUNNEL]";
const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";
const LEAD_STORAGE_KEY = "zopLeadCards";

type Listener<T> = (payload: T) => void;

export type FunnelStepEvent = {
  runId: string;
  funnelId: string;
  chatId: string;
  stepId: string;
  stepIndex: number;
  step: FunnelStep;
  resolvedDelaySec?: number;
  lead: LeadCard;
  ts: number;
};

export type FunnelErrorEvent = FunnelStepEvent & {
  error: unknown;
};

export type FunnelFinishedEvent = {
  runId: string;
  funnelId: string;
  chatId: string;
  lead: LeadCard;
  ts: number;
  status: "completed" | "cancelled" | "error";
  error?: unknown;
};

type FunnelRunInput = {
  funnel: Funnel;
  chatId: string;
  lead: LeadCard;
  integrationSettings: IntegrationSettings;
};

type FunnelRunState = {
  cancelled: boolean;
  error?: unknown;
};

type LeadStore = Record<string, LeadCard>;

type SendMessageResult = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

const runs = new Map<string, FunnelRunState>();

const listeners = {
  stepStart: new Set<Listener<FunnelStepEvent>>(),
  stepDone: new Set<Listener<FunnelStepEvent>>(),
  error: new Set<Listener<FunnelErrorEvent>>(),
  finished: new Set<Listener<FunnelFinishedEvent>>()
};

const log = (...args: unknown[]) => console.log(LOG_PREFIX, ...args);
const warn = (...args: unknown[]) => console.warn(LOG_PREFIX, ...args);
const logError = (...args: unknown[]) => console.error(LOG_PREFIX, ...args);

const createRunId = () => `zop-funnel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createRequestId = () => `zop-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const dispatchBridgeRequest = async <T>(
  detail: Record<string, unknown>,
  timeoutMs = 15000
): Promise<T | null> => {
  if (typeof window === "undefined") {
    return null;
  }

  const id = createRequestId();

  return await new Promise<T | null>((resolve) => {
    let timeoutId = 0;
    const handler = (event: Event) => {
      const responseDetail = (event as CustomEvent<{ id: string; payload?: T }>).detail;
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

const sendMessageViaPageBridge = (
  chatId: string,
  text: string,
  options?: Record<string, unknown>
): Promise<SendMessageResult | null> =>
  dispatchBridgeRequest<SendMessageResult>({ type: "send-text", chatId, text, options });

const PRESENCE_DURATION_MS = 15000;

const markChatPresence = (chatId: string, type: "mark-composing" | "mark-recording", value: boolean) => {
  if (value) {
    void dispatchBridgeRequest({ type, chatId, durationMs: PRESENCE_DURATION_MS }).catch(() => {});
    return;
  }

  void dispatchBridgeRequest({ type: "mark-paused", chatId }).catch(() => {});
};

const getMimeFromDataUrl = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.*?);base64,/);
  return match?.[1];
};

const requestMediaFromExtension = async (id: string) => {
  if (!chrome?.runtime?.connect) {
    return null;
  }

  return await new Promise<{
    id: string;
    dataUrl: string;
    mimeType?: string;
    fileName?: string;
  } | null>((resolve) => {
    let completed = false;
    let totalChunks = 0;
    const chunks: string[] = [];
    let meta: { id: string; mimeType?: string; fileName?: string } | null = null;

    const port = chrome.runtime.connect({ name: "zop:media:stream" });

    const finish = (record: { id: string; dataUrl: string; mimeType?: string; fileName?: string } | null) => {
      if (completed) {
        return;
      }
      completed = true;
      try {
        port.disconnect();
      } catch {
        // ignore
      }
      resolve(record);
    };

    port.onMessage.addListener((message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.type === "error") {
        finish(null);
        return;
      }

      if (message.type === "meta") {
        meta = {
          id: message.id,
          mimeType: message.mimeType,
          fileName: message.fileName
        };
        totalChunks = Number(message.totalChunks) || 0;
        if (totalChunks === 0) {
          finish(null);
        }
        return;
      }

      if (message.type === "chunk") {
        chunks[message.index] = message.data;
        return;
      }

      if (message.type === "done") {
        if (!meta || chunks.length < totalChunks) {
          finish(null);
          return;
        }
        finish({
          id: meta.id,
          dataUrl: chunks.join(""),
          mimeType: meta.mimeType,
          fileName: meta.fileName
        });
      }
    });

    port.postMessage({ type: "zop:media:stream", id });
  });
};

const retryRequestMedia = async (id: string, attempts = 2, delayMs = 200) => {
  let lastResult: {
    id: string;
    dataUrl: string;
    mimeType?: string;
    fileName?: string;
  } | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResult = await requestMediaFromExtension(id);
    if (lastResult?.dataUrl) {
      return lastResult;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastResult;
};

const resolveMediaPayload = async (step: FunnelStep) => {
  if (!step.mediaSource || step.mediaSource === "file") {
    if (step.mediaFileData) {
      const mimeType = step.mediaMimeType ?? getMimeFromDataUrl(step.mediaFileData);
      return {
        file: step.mediaFileData,
        filename: step.fileName || "arquivo",
        mimeType
      };
    }

    if (step.mediaId) {
      const stored = (await retryRequestMedia(step.mediaId)) ?? (await getMedia(step.mediaId));
      if (!stored?.dataUrl) {
        warn("Media not found for step", step.id, step.mediaId);
        return null;
      }
      return {
        file: stored.dataUrl,
        filename: step.fileName || stored.fileName || "arquivo",
        mimeType: stored.mimeType ?? getMimeFromDataUrl(stored.dataUrl)
      };
    }
  }

  return null;
};

const addListener = <T>(set: Set<Listener<T>>, listener: Listener<T>) => {
  set.add(listener);
  return () => set.delete(listener);
};

const emitEvent = <T>(set: Set<Listener<T>>, payload: T) => {
  set.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      logError("Listener error", error);
    }
  });
};

export const onStepStart = (listener: Listener<FunnelStepEvent>) =>
  addListener(listeners.stepStart, listener);
export const onStepDone = (listener: Listener<FunnelStepEvent>) =>
  addListener(listeners.stepDone, listener);
export const onError = (listener: Listener<FunnelErrorEvent>) =>
  addListener(listeners.error, listener);
export const onFinished = (listener: Listener<FunnelFinishedEvent>) =>
  addListener(listeners.finished, listener);

const isCancelled = (runId: string) => runs.get(runId)?.cancelled ?? false;

export const cancel = (runId: string) => {
  const state = runs.get(runId);
  if (state) {
    state.cancelled = true;
    log("Run cancelled", runId);
  }
};

const ensureLeadTags = (lead: LeadCard): LeadCard => ({
  ...lead,
  tags: Array.isArray(lead.tags) ? lead.tags : []
});

const loadLeadStore = async () => loadData<LeadStore>(LEAD_STORAGE_KEY, {});
const saveLeadStore = async (store: LeadStore) => saveData(LEAD_STORAGE_KEY, store);

const persistLead = async (lead: LeadCard) => {
  const store = await loadLeadStore();
  const key = lead.id || lead.chatId;
  store[key] = lead;
  await saveLeadStore(store);
};

const mergeTags = (lead: LeadCard, tags: string[]) => {
  const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return lead;
  }

  const nextTags = new Set(lead.tags ?? []);
  normalized.forEach((tag) => nextTags.add(tag));

  return {
    ...lead,
    tags: Array.from(nextTags),
    lastUpdateAt: Date.now()
  };
};

const waitWithCancel = async (runId: string, delayMs: number) => {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (isCancelled(runId) || Date.now() - startedAt >= delayMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 250);
  });
};

const resolvePayloadTemplate = (payloadTemplate?: Record<string, unknown>) => {
  if (!payloadTemplate) {
    return null;
  }

  return payloadTemplate;
};

const emitStepEvent = (
  runId: string,
  funnelId: string,
  chatId: string,
  step: FunnelStep,
  stepIndex: number,
  lead: LeadCard,
  resolvedDelaySec?: number
) => ({
  runId,
  funnelId,
  chatId,
  stepId: step.id,
  stepIndex,
  step,
  resolvedDelaySec,
  lead,
  ts: Date.now()
});

const sampleRandomDelaySec = () => Math.floor(Math.random() * 6) + 5;

const resolveStepDelaySec = (
  step: FunnelStep,
  integrationDefault: number,
  isSending = false
) => {
  const hasManualDelay = typeof step.delaySec === "number" || Boolean(step.delayExpr);
  if (hasManualDelay) {
    return resolveDelaySec(step, integrationDefault);
  }

  if (
    isSending &&
    step.mediaDurationMode === "file" &&
    typeof step.mediaDurationSec === "number" &&
    step.mediaDurationSec > 0
  ) {
    return step.mediaDurationSec;
  }

  if (integrationDefault && integrationDefault > 0) {
    return integrationDefault;
  }

  if (isSending) {
    return sampleRandomDelaySec();
  }

  return undefined;
};

const isSendingType = (type: FunnelStep["type"]) =>
  type === "text" || type === "audio" || type === "ptt" || type === "image" || type === "video" || type === "file";

const isRecordingType = (type: FunnelStep["type"]) => type === "ptt";

const getPresenceTypeForStep = (
  step: FunnelStep
): "mark-composing" | "mark-recording" | null => {
  if (step.type === "text") {
    return "mark-composing";
  }

  if (isRecordingType(step.type)) {
    return "mark-recording";
  }

  return null;
};

const resolveMediaType = (stepType: FunnelStep["type"]) => {
  switch (stepType) {
    case "ptt":
      return "audio";
    case "image":
      return "image";
    case "file":
      return "document";
    default:
      return "auto-detect";
  }
};

const buildSendFileOptions = (
  step: FunnelStep,
  media: { filename: string; mimeType?: string },
  caption?: string,
  overrideType?: string
) => {
  const options: Record<string, unknown> = {
    type: overrideType ?? resolveMediaType(step.type)
  };

  if (media.filename) {
    options.filename = media.filename;
  }

  if (media.mimeType) {
    options.mimetype = media.mimeType;
  }

  if (caption) {
    options.caption = caption;
  }

  if (step.type === "ptt") {
    options.isPtt = true;
  }

  return options;
};

const sendMediaStep = async (chatId: string, step: FunnelStep) => {
  const media = await resolveMediaPayload(step);
  if (!media) {
    warn("Skipping media step without source", step.id);
    return false;
  }

  const caption = step.mediaCaption?.trim() || undefined;
  const sendFile = (options: Record<string, unknown>) =>
    dispatchBridgeRequest<SendMessageResult>({
      type: "send-file",
      chatId,
      file: media.file,
      options
    });

  const primaryOptions = buildSendFileOptions(step, media, caption);
  const result = await sendFile(primaryOptions);
  if (!result?.ok && step.type === "video") {
    const fallback = await sendFile(buildSendFileOptions(step, media, caption, "video"));
    if (!fallback?.ok) {
      throw new Error(fallback?.error || "send-file-failed");
    }
    return true;
  }

  if (!result?.ok) {
    throw new Error(result?.error || "send-file-failed");
  }

  return true;
};

const runFunnelSequence = async (runId: string, input: FunnelRunInput) => {
  const { funnel, chatId, integrationSettings } = input;
  const state = runs.get(runId);
  const defaultDelaySec = integrationSettings.defaultDelaySec ?? 0;
  let currentLead = ensureLeadTags(input.lead);

  if (!state) {
    return;
  }

  log("Run started", runId, funnel.id, chatId);

  for (let index = 0; index < funnel.steps.length; index += 1) {
    if (state.cancelled) {
      break;
    }

    const step = funnel.steps[index];
    const message = step.type === "text" ? step.text?.trim() ?? "" : "";
    const isSending = isSendingType(step.type);
    const resolvedDelaySec = resolveStepDelaySec(step, defaultDelaySec, isSending);
    const delayMs =
      typeof resolvedDelaySec === "number" && resolvedDelaySec > 0 ? resolvedDelaySec * 1000 : 0;
    const stepPayload = emitStepEvent(runId, funnel.id, chatId, step, index, currentLead, resolvedDelaySec);
    emitEvent(listeners.stepStart, stepPayload);

    try {
      if (step.type === "delay") {
        if (delayMs > 0) {
          await waitWithCancel(runId, delayMs);
        }
      } else if (step.type === "tag") {
        const tagsToAdd = step.addTags ?? [];
        if (tagsToAdd.length === 0) {
          warn("Skipping tag step with no tags", step.id);
        } else {
          currentLead = mergeTags(currentLead, tagsToAdd);
          await persistLead(currentLead);
        }
      } else if (step.type === "webhook") {
        if (!integrationSettings.enableWebhook) {
          warn("Webhook disabled, skipping step", step.id);
        } else if (!integrationSettings.n8nWebhookUrl) {
          warn("Webhook URL missing, skipping step", step.id);
        } else {
          const payloadTemplateResolved = resolvePayloadTemplate(step.payloadTemplate);
          const body = {
            runId,
            chatId,
            funnelId: funnel.id,
            stepId: step.id,
            event: step.webhookEvent ?? "step",
            ts: Date.now(),
            lead: currentLead,
            payloadTemplateResolved
          };

          const response = await fetch(integrationSettings.n8nWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          });

          if (!response.ok) {
            throw new Error(`webhook-failed-${response.status}`);
          }
        }
      } else if (isSending) {
        const presenceType = getPresenceTypeForStep(step);
        let presenceActive = false;

        const activatePresence = () => {
          if (!presenceType || presenceActive) {
            return;
          }
          presenceActive = true;
          markChatPresence(chatId, presenceType, true);
        };

        const deactivatePresence = () => {
          if (!presenceType || !presenceActive) {
            return;
          }
          presenceActive = false;
          markChatPresence(chatId, presenceType, false);
        };

        const shouldUsePresence = Boolean(presenceType) && (step.type !== "text" || Boolean(message));

        try {
          if (shouldUsePresence) {
            activatePresence();
          }

          if (delayMs > 0) {
            await waitWithCancel(runId, delayMs);
          }

          if (state.cancelled) {
            break;
          }

          if (step.type === "text") {
            if (!message) {
              warn("Skipping text step with empty message", step.id);
            } else {
              const result = await sendMessageViaPageBridge(chatId, message);
              if (!result?.ok) {
                throw new Error(result?.error || "send-message-failed");
              }
            }
          } else {
            await sendMediaStep(chatId, step);
          }
        } finally {
          deactivatePresence();
        }
      } else {
        warn("Unknown step type", step.type);
      }

      if (state.cancelled) {
        break;
      }

      emitEvent(
        listeners.stepDone,
        emitStepEvent(runId, funnel.id, chatId, step, index, currentLead, resolvedDelaySec)
      );
    } catch (error) {
      state.error = error;
      emitEvent(listeners.error, {
        ...emitStepEvent(runId, funnel.id, chatId, step, index, currentLead, resolvedDelaySec),
        error
      });
      logError("Step failed", step.id, error);
      break;
    }
  }

  const status = state.cancelled ? "cancelled" : state.error ? "error" : "completed";
  emitEvent(listeners.finished, {
    runId,
    funnelId: funnel.id,
    chatId,
    lead: currentLead,
    ts: Date.now(),
    status,
    error: state.error
  });
  runs.delete(runId);
  log("Run finished", runId, status);
};

export const runFunnel = (input: FunnelRunInput) => {
  const runId = createRunId();
  runs.set(runId, { cancelled: false });
  void runFunnelSequence(runId, input);
  return runId;
};

export const exposeFunnelRunner = () => {
  if (typeof window === "undefined") {
    return;
  }

  const target = window as Window &
    typeof globalThis & {
      zopFunnelRunner?: {
        runFunnel: typeof runFunnel;
        cancel: typeof cancel;
        onStepStart: typeof onStepStart;
        onStepDone: typeof onStepDone;
        onError: typeof onError;
        onFinished: typeof onFinished;
      };
    };

  target.zopFunnelRunner = {
    runFunnel,
    cancel,
    onStepStart,
    onStepDone,
    onError,
    onFinished
  };
};
