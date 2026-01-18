export type MediaSource = "url" | "file";

export type MediaDurationMode = "manual" | "file";

export type FunnelStep = {
  id: string;
  type: "text" | "delay" | "tag" | "webhook" | "audio" | "ptt" | "image" | "video" | "file";
  text?: string;
  delaySec?: number;
  delayExpr?: string;
  addTags?: string[];
  webhookEvent?: string;
  payloadTemplate?: Record<string, unknown>;
  mediaSource?: MediaSource;
  mediaUrl?: string;
  mediaCaption?: string;
  fileName?: string;
  mediaFileData?: string;
  mediaMimeType?: string;
  mediaDurationMode?: MediaDurationMode;
  mediaDurationSec?: number;
};

export type Funnel = {
  id: string;
  name: string;
  description?: string;
  steps: FunnelStep[];
};

export type LeadCard = {
  id: string;
  chatId: string;
  title: string;
  laneId: "novo" | "qualificado" | "proposta" | "fechado";
  tags: string[];
  notes?: string;
  lastUpdateAt: number;
};

export type IntegrationSettings = {
  n8nWebhookUrl?: string;
  n8nSecret?: string;
  enableWebhook: boolean;
  defaultDelaySec?: number;
};

export type QuickReplyMediaType = "text" | "audio" | "ptt" | "image" | "video" | "file";

export type QuickReply = {
  id: string;
  title: string;
  categoryId: string;
  message: string;
  variables?: string[];
  mediaType?: QuickReplyMediaType;
  mediaSource?: MediaSource;
  mediaUrl?: string;
  mediaCaption?: string;
  fileName?: string;
  mediaFileData?: string;
  mediaMimeType?: string;
  businessTags?: string[];
  createdAt: number;
  updatedAt: number;
};
