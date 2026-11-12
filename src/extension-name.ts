import type { UiLanguage } from "./i18n"

export function getExtensionName(language?: UiLanguage): string {
  if (language) return language === "zh-CN" ? "熊灵" : "Spirit Bear"
  return chrome.i18n.getMessage("extensionName") || "Spirit Bear"
}

export function getExtensionActionTitle(language: UiLanguage): string {
  const name = getExtensionName(language)
  return language === "zh-CN" ? "打开" + name : "Open " + name
}
