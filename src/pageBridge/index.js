const REQUEST_EVENT = "zop:request";
const RESPONSE_EVENT = "zop:response";

const emitWppEvent = (detail) => {
  window.dispatchEvent(new CustomEvent("zop:wpp", { detail }));
};

const emitResponse = (id, payload) => {
  window.dispatchEvent(
    new CustomEvent(RESPONSE_EVENT, {
      detail: {
        id,
        payload
      }
    })
  );
};

const withTimeout = (promise, ms) =>
  new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ timedOut: true });
    }, ms);

    promise
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve({ timedOut: false, value });
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve({ timedOut: false, error });
      });
  });

const hasOwn = (target, key) => Object.prototype.hasOwnProperty.call(target, key);

const getDetailValue = (detail, key) => {
  if (!detail) {
    return undefined;
  }

  if (hasOwn(detail, key)) {
    return detail[key];
  }

  const payload = detail.payload;
  if (payload && hasOwn(payload, key)) {
    return payload[key];
  }

  return undefined;
};

const resolveMaybePromise = (value, callback) => {
  if (value && typeof value.then === "function") {
    value.then(callback).catch(() => callback(null));
    return;
  }

  callback(value);
};

const serializeChat = (chat) => {
  if (!chat) {
    return null;
  }

  const rawId = chat.id && (chat.id._serialized || chat.id);
  if (!rawId) {
    return null;
  }

  const name = chat.name || chat.formattedTitle || chat.contact?.name || chat.subject;
  return {
    id: rawId,
    name
  };
};

const isWppReady = () => {
  const wpp = window.WPP;
  if (!wpp) {
    return false;
  }
  if (wpp.isReady || wpp.isFullReady) {
    return true;
  }
  return Boolean(wpp.chat);
};

const getActiveChat = () => {
  const wpp = window.WPP;
  if (!wpp || !wpp.chat) {
    return null;
  }

  try {
    if (typeof wpp.chat.getActiveChat === "function") {
      return wpp.chat.getActiveChat();
    }

    if (typeof wpp.chat.getActiveChatId === "function" && typeof wpp.chat.getChat === "function") {
      const activeId = wpp.chat.getActiveChatId();
      if (activeId && typeof activeId.then === "function") {
        return activeId.then((resolvedId) => (resolvedId ? wpp.chat.getChat(resolvedId) : null));
      }

      return activeId ? wpp.chat.getChat(activeId) : null;
    }
  } catch {
    return null;
  }

  return null;
};

const getChatById = (chatId) => {
  const wpp = window.WPP;
  if (!wpp || !wpp.chat || typeof wpp.chat.getChat !== "function") {
    return null;
  }

  try {
    return wpp.chat.getChat(chatId);
  } catch {
    return null;
  }
};

const handleRequest = (event) => {
  const detail = event.detail || {};
  if (!detail.id) {
    return;
  }

  if (detail.type === "active-chat") {
    if (!isWppReady()) {
      emitResponse(detail.id, null);
      return;
    }
    const result = getActiveChat();
    resolveMaybePromise(result, (chat) => {
      emitResponse(detail.id, serializeChat(chat));
    });
    return;
  }

  if (detail.type === "get-chat") {
    if (!isWppReady()) {
      emitResponse(detail.id, null);
      return;
    }
    const chatId = getDetailValue(detail, "chatId");
    if (!chatId) {
      emitResponse(detail.id, null);
      return;
    }

    const result = getChatById(chatId);
    resolveMaybePromise(result, (chat) => {
      emitResponse(detail.id, serializeChat(chat));
    });
    return;
  }

  if (detail.type === "insert-text") {
    const chatId = getDetailValue(detail, "chatId");
    const text = getDetailValue(detail, "text");

    if (typeof text !== "string" || !text.trim()) {
      emitResponse(detail.id, { ok: false, error: "invalid-payload" });
      return;
    }

    const wpp = window.WPP;
    if (!wpp?.chat || typeof wpp.chat.setInputText !== "function") {
      emitResponse(detail.id, { ok: false, error: "wpp-not-ready" });
      return;
    }

    try {
      const call = () => {
        if (chatId && wpp.chat.setInputText.length >= 2) {
          return wpp.chat.setInputText(chatId, text);
        }

        return wpp.chat.setInputText(text);
      };

      resolveMaybePromise(call(), (result) => {
        emitResponse(detail.id, { ok: true, result });
      });
    } catch (error) {
      emitResponse(detail.id, { ok: false, error: error?.message || String(error) });
    }
    return;
  }

  if (detail.type === "send-text" || detail.type === "send-message") {
    const chatId = getDetailValue(detail, "chatId");
    const text = getDetailValue(detail, "text");
    const options = getDetailValue(detail, "options");

    if (!chatId || typeof text !== "string" || !text.trim()) {
      emitResponse(detail.id, { ok: false, error: "invalid-payload" });
      return;
    }

    const wpp = window.WPP;
    if (!wpp?.chat || typeof wpp.chat.sendTextMessage !== "function") {
      emitResponse(detail.id, { ok: false, error: "wpp-not-ready" });
      return;
    }

    withTimeout(Promise.resolve(wpp.chat.sendTextMessage(chatId, text, options)), 12000).then(
      (outcome) => {
        if (outcome.timedOut) {
          emitResponse(detail.id, { ok: true, timeout: true });
          return;
        }
        if (outcome.error) {
          emitResponse(detail.id, { ok: false, error: outcome.error?.message || String(outcome.error) });
          return;
        }
        emitResponse(detail.id, { ok: true, result: outcome.value });
      }
    );
    return;
  }

  if (detail.type === "mark-composing" || detail.type === "mark-recording") {
    const chatId = getDetailValue(detail, "chatId");
    const durationMs = getDetailValue(detail, "durationMs");
    if (!chatId) {
      emitResponse(detail.id, { ok: false, error: "missing-chat" });
      return;
    }

    const method = detail.type === "mark-composing" ? "markIsComposing" : "markIsRecording";
    const wpp = window.WPP;
    if (!wpp?.chat || typeof wpp.chat[method] !== "function") {
      emitResponse(detail.id, { ok: false, error: "wpp-not-ready" });
      return;
    }

    try {
      const timeout =
        typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined;
      const call = () => wpp.chat[method](chatId, timeout);
      resolveMaybePromise(call(), () => {
        emitResponse(detail.id, { ok: true });
      });
    } catch (error) {
      emitResponse(detail.id, { ok: false, error: error?.message || String(error) });
    }
    return;
  }

  if (detail.type === "send-file") {
    const chatId = getDetailValue(detail, "chatId");
    const file = getDetailValue(detail, "file");
    const filename = getDetailValue(detail, "filename");
    const caption = getDetailValue(detail, "caption");
    const options = getDetailValue(detail, "options");

    if (!chatId || !file) {
      emitResponse(detail.id, { ok: false, error: "invalid-payload" });
      return;
    }

    const wpp = window.WPP;
    if (!wpp?.chat || typeof wpp.chat.sendFileMessage !== "function") {
      emitResponse(detail.id, { ok: false, error: "wpp-not-ready" });
      return;
    }

    const normalizedOptions = options && typeof options === "object" ? { ...options } : {};
    if (filename && !normalizedOptions.filename) {
      normalizedOptions.filename = filename;
    }
    if (caption && !normalizedOptions.caption) {
      normalizedOptions.caption = caption;
    }

    const resolveSendFileTimeout = (opts) => {
      if (opts?.isPtv || opts?.type === "video") {
        return 30000;
      }
      if (opts?.type === "audio") {
        return 20000;
      }
      if (opts?.type === "image") {
        return 20000;
      }
      if (opts?.type === "document" || opts?.type === "file") {
        return 25000;
      }
      return 25000;
    };

    withTimeout(
      Promise.resolve(wpp.chat.sendFileMessage(chatId, file, normalizedOptions)),
      resolveSendFileTimeout(normalizedOptions)
    ).then((outcome) => {
      if (outcome.timedOut) {
        emitResponse(detail.id, { ok: true, timeout: true });
        return;
      }
      if (outcome.error) {
        emitResponse(detail.id, { ok: false, error: outcome.error?.message || String(outcome.error) });
        return;
      }
      emitResponse(detail.id, { ok: true, result: outcome.value });
    });
    return;
  }

  if (detail.type === "mark-paused") {
    const chatId = getDetailValue(detail, "chatId");
    if (!chatId) {
      emitResponse(detail.id, { ok: false, error: "missing-chat" });
      return;
    }

    const wpp = window.WPP;
    if (!wpp?.chat || typeof wpp.chat.markIsPaused !== "function") {
      emitResponse(detail.id, { ok: false, error: "wpp-not-ready" });
      return;
    }

    try {
      resolveMaybePromise(wpp.chat.markIsPaused(chatId), () => {
        emitResponse(detail.id, { ok: true });
      });
    } catch (error) {
      emitResponse(detail.id, { ok: false, error: error?.message || String(error) });
    }
    return;
  }

  emitResponse(detail.id, { ok: false, error: "unsupported-request" });
};

const waitForWpp = () => {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    const wpp = window.WPP;
    if (wpp) {
      window.clearInterval(timer);
      emitWppEvent({ status: "ready", version: wpp.version });
      return;
    }

    if (Date.now() - startedAt > 15000) {
      window.clearInterval(timer);
      emitWppEvent({ status: "timeout" });
    }
  }, 300);
};

window.addEventListener(REQUEST_EVENT, handleRequest);
waitForWpp();
