import { readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { defineConfig } from "wxt"

const require = createRequire(import.meta.url)
const icons = { 16: "icon/16.png", 24: "icon/24.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" }

export default defineConfig({
  hooks: {
    "build:publicAssets"(_wxt, files) {
      const cmaps = join(dirname(require.resolve("pdfjs-dist/package.json")), "cmaps")
      for (const file of readdirSync(cmaps)) files.push({ absoluteSrc: join(cmaps, file), relativeDest: "pdf-cmaps/" + file })
    },
  },
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    minimum_chrome_version: "116",
    action: { default_title: "__MSG_openExtension__", default_icon: icons },
    icons,
    permissions: ["sidePanel", "tabs", "tabGroups", "scripting", "storage", "downloads"],
    optional_host_permissions: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
    incognito: "not_allowed",
  },
})
