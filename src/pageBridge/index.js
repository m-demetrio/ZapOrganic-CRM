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

const handleRequest = (event) => {
  const detail = event.detail || {};
  if (detail.type !== "active-chat" || !detail.id) {
    return;
  }

  const result = getActiveChat();
  resolveMaybePromise(result, (chat) => {
    emitResponse(detail.id, serializeChat(chat));
  });
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
