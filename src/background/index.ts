import { getMedia } from "../shared/mediaStore";

type MediaResponse = {
  ok: boolean;
  record?: {
    id: string;
    dataUrl: string;
    mimeType?: string;
    fileName?: string;
    updatedAt: number;
  } | null;
  error?: string;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "zop:media:get") {
    const id = message.id as string | undefined;
    if (!id) {
      sendResponse({ ok: false, error: "missing-id" } satisfies MediaResponse);
      return;
    }

    getMedia(id)
      .then((record) => {
        sendResponse({ ok: true, record: record ?? null } satisfies MediaResponse);
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) } satisfies MediaResponse);
      });
    return true;
  }
});

const CHUNK_SIZE = 200_000;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "zop:media:stream") {
    return;
  }

  port.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || message.type !== "zop:media:stream") {
      return;
    }

    const id = message.id as string | undefined;
    if (!id) {
      port.postMessage({ type: "error", error: "missing-id" });
      return;
    }

    getMedia(id)
      .then((record) => {
        if (!record?.dataUrl) {
          port.postMessage({ type: "error", error: "not-found" });
          return;
        }

        const total = record.dataUrl.length;
        const totalChunks = Math.ceil(total / CHUNK_SIZE);
        port.postMessage({
          type: "meta",
          id: record.id,
          mimeType: record.mimeType,
          fileName: record.fileName,
          totalChunks
        });

        for (let index = 0; index < totalChunks; index += 1) {
          const start = index * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, total);
          port.postMessage({
            type: "chunk",
            index,
            data: record.dataUrl.slice(start, end)
          });
        }

        port.postMessage({ type: "done" });
      })
      .catch((error) => {
        port.postMessage({ type: "error", error: error?.message || String(error) });
      });
  });
});
