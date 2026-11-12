export function getExtensionName(): string {
  return chrome.i18n.getMessage("extensionName") || "Spirit Bear"
}
