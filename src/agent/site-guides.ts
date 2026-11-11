import { pageOrigin } from "../browser/urls"

const keyPrefix = "site-guide:"
export const siteGuideLimit = 1000

interface SiteGuide {
  origin: string
  note: string
}

export async function readSiteGuides(): Promise<SiteGuide[]> {
  const entries = Object.entries(await chrome.storage.local.get(null))
  return entries.flatMap(([key, note]) => {
    const origin = key.slice(keyPrefix.length)
    return key.startsWith(keyPrefix) && pageOrigin(origin) === origin && typeof note === "string" && note.trim()
      ? [{ origin, note: note.slice(0, siteGuideLimit) }] : []
  }).sort((a, b) => a.origin.localeCompare(b.origin))
}

export async function saveSiteGuide(site: string, note: string): Promise<string> {
  const value = site.trim()
  const origin = pageOrigin(value.includes("://") ? value : "https://" + value)
  if (!origin) throw new Error("请输入站点域名或 HTTPS 网址")
  const text = note.trim()
  if (!text || text.length > siteGuideLimit) throw new Error("请填写 1 到 " + siteGuideLimit + " 字的操作指引")
  await chrome.storage.local.set({ [keyPrefix + origin]: text })
  return origin
}

export function removeSiteGuide(origin: string): Promise<void> {
  return chrome.storage.local.remove(keyPrefix + origin)
}
