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
