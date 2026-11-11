export function httpsUrl(input: string): URL {
  const url = new URL(input)
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("仅支持不含凭据的 HTTPS 地址")
  }
  return url
}

export function pageOrigin(input: string): string | undefined {
  try {
    const url = httpsUrl(input)
    if (url.hostname === "chromewebstore.google.com" ||
        (url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"))) return
    return url.origin
  } catch {
    return
  }
}

export function hostPattern(origin: string): string {
  return "https://" + httpsUrl(origin).hostname + "/*"
}

const trackingParameter = /^(?:utm_.+|spm|fbclid|gclid|xsec_source)$/i
const privateParameter = /^(?:code|signature|sign|session(?:_?id)?|(?:.+[_-])?(?:token|secret|password|api[_-]?key)|auth|authorization)$/i

export function cleanPageUrl(input: string): string {
  const url = httpsUrl(input)
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParameter.test(key) || privateParameter.test(key)) url.searchParams.delete(key)
  }
  if (!/^#!?\/[^\s?=&]+$/.test(url.hash)) url.hash = ""
  return url.href
}

export function citationPageUrl(input: string, canonical?: string): string | undefined {
  const url = httpsUrl(input)
  const cleaned = cleanPageUrl(input)
  if (![...url.searchParams.keys()].some(key => privateParameter.test(key))) return cleaned
  if (!canonical || pageOrigin(canonical) !== url.origin) return
  const publicUrl = httpsUrl(canonical)
  if ([...publicUrl.searchParams.keys()].some(key => privateParameter.test(key))) return
  const candidate = cleanPageUrl(canonical)
  return candidate === cleaned ? candidate : undefined
}
