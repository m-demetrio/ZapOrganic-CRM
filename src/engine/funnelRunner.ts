import { resolveDelaySec } from "../shared/delay";
import { loadData, saveData } from "../shared/storage";
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

const sendMessageViaPageBridge = async (
  chatId: string,
  text: string,
  options?: Record<string, unknown>
): Promise<SendMessageResult> => {
  if (typeof window === "undefined") {
    return { ok: false, error: "window-unavailable" };
  }

  const id = createRequestId();

  return await new Promise<SendMessageResult>((resolve) => {
    let timeoutId = 0;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; payload?: SendMessageResult }>).detail;
      if (!detail || detail.id !== id) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve(detail.payload ?? { ok: false, error: "empty-response" });
    };

    timeoutId = window.setTimeout(() => {
      window.removeEventListener(RESPONSE_EVENT, handler);
      resolve({ ok: false, error: "timeout" });
    }, 15000);

    window.addEventListener(RESPONSE_EVENT, handler);
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: {
          id,
          type: "send-text",
          chatId,
          text,
          options
        }
      })
    );

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
  lead: LeadCard
) => ({
  runId,
  funnelId,
  chatId,
  stepId: step.id,
  stepIndex,
  step,
  lead,
  ts: Date.now()
});

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
    const stepPayload = emitStepEvent(runId, funnel.id, chatId, step, index, currentLead);
    emitEvent(listeners.stepStart, stepPayload);

    try {
      if (step.type === "text") {
        const message = step.text?.trim() ?? "";
        if (!message) {
          warn("Skipping text step with empty message", step.id);
        } else {
          const delaySec = resolveDelaySec(step, defaultDelaySec);
          await waitWithCancel(runId, delaySec * 1000);
          if (state.cancelled) {
            break;
          }

          const result = await sendMessageViaPageBridge(chatId, message);
          if (!result.ok) {
            throw new Error(result.error || "send-message-failed");
          }
        }
      } else if (step.type === "delay") {
        const delaySec = resolveDelaySec(step, defaultDelaySec);
        await waitWithCancel(runId, delaySec * 1000);
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
      } else {
        warn("Unknown step type", step.type);
      }

      if (state.cancelled) {
        break;
      }

      emitEvent(listeners.stepDone, emitStepEvent(runId, funnel.id, chatId, step, index, currentLead));
    } catch (error) {
      state.error = error;
      emitEvent(listeners.error, {
        ...emitStepEvent(runId, funnel.id, chatId, step, index, currentLead),
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
