# ZapOrganic CRM (Chrome Extension MV3)

MVP resetado: injeta uma sidebar retratil no WhatsApp Web usando Shadow DOM e prepara o carregamento local do WPP/wa-js.

## Requisitos

- Node.js 18+
- pnpm
- Google Chrome

## Instalar

```bash
pnpm install
```

## Dev (watch)

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

## Typecheck

```bash
pnpm typecheck
```

## Lint

```bash
pnpm lint
```

## Como carregar no Chrome

1. Acesse `chrome://extensions`.
2. Ative o Modo do desenvolvedor.
3. Clique em Load unpacked.
4. Selecione a pasta `dist/`.

## Validacao rapida

1. Rode `pnpm dev` e confirme que `dist/` foi criado.
2. Abra `https://web.whatsapp.com/`.
3. Veja a sidebar roxa do ZapOrganic no lado direito.
4. Use o handle ou `Ctrl+Shift+Y` para recolher/abrir.
5. Selecione uma conversa e clique em uma etapa do funil para salvar.

## Testes de delay (manual)

```ts
// Exemplos de validacao rapida do parser de delays (resultado em segundos).
// Ajuste o caminho do import conforme o seu ambiente.
import { resolveDelaySec } from "./src/shared/delay";

const delayRand = resolveDelaySec({ delayExpr: "rand(5,10)" });
// Exemplo de saida: 7 (segundos)

const delayRange = resolveDelaySec({ delayExpr: "8..12" });
// Exemplo de saida: 9 (segundos)

const delayFixed = resolveDelaySec({ delayExpr: "15" });
// Resultado esperado: 15 (segundos)

console.log({ delayRand, delayRange, delayFixed });
```

## Execucao manual de funis (console)

1. Abra o WhatsApp Web com a extensao carregada.
2. Abra o DevTools, selecione o contexto do content script (ex: "ZapOrganic CRM").
3. Rode o snippet abaixo para iniciar um funil manualmente:

```ts
const runner = window.zopFunnelRunner;

const funnel = {
  id: "demo-funnel",
  name: "Demo",
  steps: [
    { id: "step-1", type: "text", text: "Oi! Este e um teste." },
    { id: "step-2", type: "delay", delaySec: 2 },
    { id: "step-3", type: "tag", addTags: ["teste", "lead"] }
  ]
};

const lead = {
  id: "lead-demo",
  chatId: "5511999999999@c.us",
  title: "Lead Demo",
  laneId: "novo",
  tags: [],
  lastUpdateAt: Date.now()
};

const integrationSettings = {
  enableWebhook: false,
  defaultDelaySec: 0
};

runner.onStepStart((event) => console.log("start", event));
runner.onStepDone((event) => console.log("done", event));
runner.onError((event) => console.error("error", event));
runner.onFinished((event) => console.log("finished", event));

const runId = runner.runFunnel({
  funnel,
  chatId: lead.chatId,
  lead,
  integrationSettings
});

// Para cancelar:
// runner.cancel(runId);
```

## Estrutura

```
./src
|- content/     # Content script (injeta UI + page bridge)
|- sidebar/     # Sidebar em Shadow DOM
|- pageBridge/  # WPP/wa-js no contexto da pagina
```

## Dados e schema

As estruturas principais ficam em `src/shared/schema.ts`:

- `QuickReply`: mensagens rapidas com categoria, variaveis e timestamps.
- `FunnelStep`: etapa do funil com suporte a texto, delay, tags e webhook.
- `Funnel`: conjunto de etapas com nome e descricao.
- `LeadCard`: lead do kanban com laneId, tags, notas e ultima atualizacao.
- `IntegrationSettings`: configuracoes do webhook (n8n) e delays padrao.

Persistencia fica em `src/shared/storage.ts` usando `chrome.storage.local` (com fallback para `localStorage`).
Existe `schemaVersion` para migracoes futuras e os dados serao exportaveis/importaveis em uma proxima etapa.

## WPP local

O arquivo `public/wppconnect-wa.js` e copiado de `node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js`.
Ao atualizar a dependencia, recopie esse arquivo.

## Logo

Coloque o arquivo `public/logo-zaporganic.png` com o logo oficial.
