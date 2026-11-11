export interface SearchSnapshot {
  url: string
  text: string
}

export function requiresSearchBox(task: string): boolean {
  if (/(?:不用|无需|不要|不必).{0,5}(?:搜索框|搜索栏)/.test(task)) return false
  if (/(?:怎么|如何|怎样|为什么|\bhow\s+(?:to|do|can)\b).{0,20}(?:搜索框|搜索栏|search (?:box|field|bar))/i.test(task)) return false
  return /(?:使用|用|通过|在|操作)[^\n，。！？]{0,24}(?:搜索框|搜索栏|搜索输入框)|\b(?:use|using|via|through)\s+(?:the |its )?search (?:box|field|bar)\b/i.test(task)
}

export function searchWasObserved(query: string, before: SearchSnapshot, after: SearchSnapshot): boolean {
  if (!after.text.trim()) return false
  const keyword = query.normalize("NFKC").trim().toLowerCase()
  return before.url !== after.url || Boolean(keyword && before.text !== after.text &&
    after.text.normalize("NFKC").toLowerCase().includes(keyword))
}
