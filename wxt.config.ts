import { defineConfig } from "wxt"

export default defineConfig({
  manifest: {
    name: "TabErrand",
    minimum_chrome_version: "116",
    action: { default_title: "打开 TabErrand" },
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    permissions: ["sidePanel", "tabs", "tabGroups", "scripting", "storage", "downloads"],
    optional_host_permissions: ["https://*/*"],
    incognito: "not_allowed",
  },
})
