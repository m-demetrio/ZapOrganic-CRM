import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";

const manifest = {
  manifest_version: 3,
  name: "ZapOrganic CRM",
  version: "0.0.1",
  description: "ZapOrganic CRM MVP com sidebar retratil no WhatsApp Web.",
  host_permissions: ["https://web.whatsapp.com/*"],
  permissions: ["storage"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  action: {
    default_title: "ZapOrganic CRM"
  },
  options_ui: {
    page: "options/options.html",
    open_in_tab: true
  },
  options_page: "options/options.html",
  content_scripts: [
    {
      matches: ["https://web.whatsapp.com/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: [
        "src/pageBridge/index.js",
        "wppconnect-wa.js",
        "logo-zaporganic.png",
        "options/options.html",
        "dashboard/dashboard.html"
      ],
      matches: ["https://web.whatsapp.com/*"]
    }
  ]
};

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";

  return {
    build: {
      outDir: "dist",
      sourcemap: isDev,
      minify: isDev ? false : "esbuild",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          options: "options/options.html"
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    },
    plugins: [crx({ manifest })]
  };
});
