export type QuickReply = {
  id: string;
  title: string;
  categoryId: string;
  message: string;
  variables?: string[];
  createdAt: number;
  updatedAt: number;
};

export type FunnelStep = {
  id: string;
  type: "text" | "delay" | "tag" | "webhook";
  text?: string;
  delaySec?: number;
  delayExpr?: string;
  addTags?: string[];
  webhookEvent?: string;
  payloadTemplate?: Record<string, unknown>;
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
