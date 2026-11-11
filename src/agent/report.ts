import { cleanPageUrl } from "../browser/urls"
import type { ReportDraft } from "./contracts"

export interface Evidence {
  id: string
  title: string
  url: string
  excerpt: string
  capturedAt: string
}

export interface Criteria {
  sourceCount: number
  topics: string[]
}

export interface Artifact {
  title: string
  filename: string
  markdown: string
  sources: Evidence[]
  complete: boolean
  gaps: string[]
}

function markdownText(text: string): string {
  const value = text.trim().replace(/\s+/g, " ")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  return value.replace(/[\\*_[\]~!#|]/g, "\\$&").replaceAll(String.fromCharCode(96), "\\" + String.fromCharCode(96))
}

function fileName(title: string, runId: string): string {
  const safe = title.normalize("NFKC").replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 45)
  return (safe || "网页资料") + "-" + runId.slice(0, 8) + ".md"
}

function renderArtifact(runId: string, title: string, sections: string[], sources: Evidence[], gaps: string[]): Artifact {
  const sourceList = sources.map((source, index) =>
    String(index + 1) + ". [" + markdownText(source.title) + "](<" + source.url + ">)")
  const markdown = [
    "# " + markdownText(title),
    ...(gaps.length ? ["## 待补充", ...gaps.map(gap => "- " + markdownText(gap))] : []),
    ...sections,
    ...(sourceList.length ? ["## 来源", sourceList.join("\n")] : []),
  ].join("\n\n") + "\n"
  return { title, filename: fileName(title, runId), markdown, sources, complete: gaps.length === 0, gaps }
}

export function buildReport(runId: string, criteria: Criteria, evidence: Evidence[], draft: ReportDraft): Artifact {
  const evidenceById = new Map(evidence.map(source => [source.id, { ...source, url: cleanPageUrl(source.url) }]))
  const sources: Evidence[] = []
  const sourceNumbers = new Map<string, number>()
  const writtenHeadings: string[] = []
  const gaps: string[] = []
  const sections: string[] = []
  let omitted = 0

  for (const section of draft.sections) {
    const items: string[] = []
    for (const item of section.items) {
      const citations = item.evidenceIds.map(id => evidenceById.get(id))
      if (citations.length === 0 || citations.some(source => !source)) {
        omitted += 1
        continue
      }
      const numbers = new Set<number>()
      for (const source of citations) {
        if (!source) continue
        let number = sourceNumbers.get(source.url)
        if (number === undefined) {
          sources.push(source)
          number = sources.length
          sourceNumbers.set(source.url, number)
        }
        numbers.add(number)
      }
      items.push("- " + markdownText(item.text) + " " + [...numbers].map(number => "[" + number + "]").join(" "))
    }
    if (items.length) {
      writtenHeadings.push(section.heading)
      sections.push("## " + markdownText(section.heading) + "\n\n" + items.join("\n"))
    }
  }

  const comparable = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "")
  const missing = criteria.topics.filter(topic => !writtenHeadings.some(heading => comparable(heading).includes(comparable(topic))))
  if (omitted) gaps.push("有 " + omitted + " 条归纳缺少有效来源")
  if (!sections.length) gaps.push("尚无带有效引用的归纳")
  if (sources.length < criteria.sourceCount) gaps.push("需要 " + criteria.sourceCount + " 条独立来源，当前引用 " + sources.length + " 条")
  if (missing.length) gaps.push("缺少主题 " + missing.join("、"))

  return renderArtifact(runId, draft.title, sections, sources, gaps)
}

export function evidenceDraft(runId: string, evidence: Evidence[], reason: string): Artifact | undefined {
  if (!evidence.length) return
  const lines = evidence.map((source, index) => "- " + markdownText(source.title) + " [" + (index + 1) + "]\n  " + markdownText(source.excerpt))
  return renderArtifact(runId, "网页资料采集草稿", ["## 已采集资料\n\n" + lines.join("\n")], evidence, [reason])
}
