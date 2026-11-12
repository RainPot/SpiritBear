import { readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { defineConfig } from "wxt"

const require = createRequire(import.meta.url)

export default defineConfig({
  hooks: {
    "build:publicAssets"(_wxt, files) {
      const cmaps = join(dirname(require.resolve("pdfjs-dist/package.json")), "cmaps")
      for (const file of readdirSync(cmaps)) files.push({ absoluteSrc: join(cmaps, file), relativeDest: "pdf-cmaps/" + file })
    },
  },
  manifest: {
    name: "TabErrand",
    minimum_chrome_version: "116",
    action: { default_title: "打开 TabErrand" },
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    permissions: ["sidePanel", "tabs", "tabGroups", "scripting", "storage", "downloads"],
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    incognito: "not_allowed",
  },
})
