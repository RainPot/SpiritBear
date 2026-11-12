import { english } from "./english"

export type UiLanguage = "zh-CN" | "en"

export const uiLanguageKey = "uiLanguage"

export function resolveUiLanguage(value?: unknown): UiLanguage {
  if (value === "zh-CN" || value === "en") return value
  return /^zh(?:-|$)/i.test(chrome.i18n.getUILanguage()) ? "zh-CN" : "en"
}

export async function readUiLanguage(): Promise<UiLanguage> {
  const values = await chrome.storage.local.get(uiLanguageKey)
  return resolveUiLanguage(values[uiLanguageKey])
}

// 历史对话保存的是原始状态文案，显示时按当前界面语言格式化。
const savedMessageFormats: ReadonlyArray<readonly [RegExp, string]> = [
  [/^每条消息最多添加 (?<count>\d+) 个附件$/, "每条消息最多添加 {count} 个附件"],
  [/^请填写 1 到 (?<count>\d+) 字的操作指引$/, "请填写 1 到 {count} 字的操作指引"],
  [/^模型 API 返回 HTTP (?<status>\d+)，请确认所选模型支持图片输入$/, "模型 API 返回 HTTP {status}，请确认所选模型支持图片输入"],
  [/^模型 API 返回 HTTP (?<status>\d+)，请检查模型 ID 与工具调用支持$/, "模型 API 返回 HTTP {status}，请检查模型 ID 与工具调用支持"],
  [/^需要授权访问 (?<origin>https:\/\/\S+)$/, "需要授权访问 {origin}"],
  [/^请在普通 Chrome 窗口使用(?<name>熊灵|Spirit Bear)$/, "请在普通 Chrome 窗口使用{name}"],
  [/^搜索「(?<query>.*)」$/s, "搜索「{query}」"],
  [/^复用已采集来源 · (?<title>.+)$/s, "复用已采集来源 · {title}"],
  [/^通过 · (?<count>\d+) 条来源$/, "通过 · {count} 条来源"],
  [/^(?<query>.+) · (?<count>\d+) 条来源$/s, "{query} · {count} 条来源"],
  [/^有 (?<count>\d+) 条归纳缺少有效来源$/, "有 {count} 条归纳缺少有效来源"],
  [/^需要 (?<count>\d+) 条独立来源，当前引用 (?<current>\d+) 条$/, "需要 {count} 条独立来源，当前引用 {current} 条"],
  [/^缺少主题 (?<topics>.+)$/s, "缺少主题 {topics}"],
]

export type Translate = (message: string, values?: Record<string, string | number>) => string

export function translate(language: UiLanguage, message: string, values?: Record<string, string | number>): string {
  const localized = language === "en" && Object.hasOwn(english, message) ? english[message] : undefined
  if (values) {
    return (localized ?? message).replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
  }
  if (language === "en" && localized === undefined) {
    for (const [pattern, key] of savedMessageFormats) {
      const captures = message.match(pattern)?.groups
      if (captures) return translate(language, key, captures)
    }
  }
  return localized ?? message
}
