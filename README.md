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

## Estrutura

```
./src
|- content/     # Content script (injeta UI + page bridge)
|- sidebar/     # Sidebar em Shadow DOM
|- pageBridge/  # WPP/wa-js no contexto da pagina
```

## WPP local

O arquivo `public/wppconnect-wa.js` e copiado de `node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js`.
Ao atualizar a dependencia, recopie esse arquivo.

## Logo

Coloque o arquivo `public/logo-zaporganic.png` com o logo oficial.
