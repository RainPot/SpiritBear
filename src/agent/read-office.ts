import { strFromU8, unzipSync } from "fflate"
import readXlsxFile from "read-excel-file/universal"
import { maxDocumentCharacters } from "./attachments"
import type { ExtractedText } from "./read-attachment"

export function readWord(data: ArrayBuffer): ExtractedText {
  const path = "word/document.xml"
  const entry = unzipSync(new Uint8Array(data), {
    filter: file => file.name === path && file.originalSize <= 16 * 1024 * 1024,
  })[path]
  if (!entry) throw new Error("DOCX 正文缺失或解压后过大")
  const document = new DOMParser().parseFromString(strFromU8(entry), "application/xml")
  const namespace = document.documentElement.namespaceURI
  const paragraphs = document.getElementsByTagNameNS(namespace, "p")
  const text: string[] = []
  let length = 0
  for (const paragraph of paragraphs) {
    const line = Array.from(paragraph.getElementsByTagNameNS(namespace, "t"), item => item.textContent).join("")
    if (!line.trim()) continue
    text.push(line)
    length += line.length + 1
    if (length > maxDocumentCharacters) return { text: text.join("\n"), truncated: true }
  }
  return { text: text.join("\n") }
}

export async function readWorkbook(data: ArrayBuffer): Promise<ExtractedText> {
  let unpacked = 0
  // 先检查压缩目录，避免大型工作簿占满侧栏进程内存。
  unzipSync(new Uint8Array(data), { filter: file => {
    unpacked += file.originalSize
    if (unpacked > 64 * 1024 * 1024) throw new Error("XLSX 解压后过大，请拆分工作簿")
    return false
  } })
  const sheets = await readXlsxFile(data)
  const lines: string[] = []
  let length = 0
  for (const { sheet, data: rows } of sheets) {
    if (!rows.length) continue
    lines.push("工作表 " + sheet)
    length += sheet.length + 5
    for (const row of rows) {
      const line = row.map(cell => cell instanceof Date ? cell.toISOString() : String(cell ?? "")).join("\t")
      lines.push(line)
      length += line.length + 1
      if (length > maxDocumentCharacters) return { text: lines.join("\n"), truncated: true }
    }
  }
  return { text: lines.join("\n") }
}
