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

const getActiveChat = () => {
  const wpp = window.WPP;
  if (!wpp || !wpp.chat) {
    return null;
  }

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

  return null;
};

const getChatById = (chatId) => {
  const wpp = window.WPP;
  if (!wpp || !wpp.chat || typeof wpp.chat.getChat !== "function") {
    return null;
  }

  return wpp.chat.getChat(chatId);
};

const handleRequest = (event) => {
  const detail = event.detail || {};
  if (!detail.id) {
    return;
  }

  if (detail.type === "active-chat") {
    const result = getActiveChat();
    resolveMaybePromise(result, (chat) => {
      emitResponse(detail.id, serializeChat(chat));
    });
    return;
  }

  if (detail.type === "get-chat") {
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

    Promise.resolve(wpp.chat.sendTextMessage(chatId, text, options))
      .then((result) => emitResponse(detail.id, { ok: true, result }))
      .catch((error) => {
        emitResponse(detail.id, { ok: false, error: error?.message || String(error) });
      });
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

    Promise.resolve(wpp.chat.sendFileMessage(chatId, file, filename, caption, options))
      .then((result) => emitResponse(detail.id, { ok: true, result }))
      .catch((error) => {
        emitResponse(detail.id, { ok: false, error: error?.message || String(error) });
      });
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
