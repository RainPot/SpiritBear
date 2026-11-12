import { getDocument, PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs"
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"
import { maxDocumentCharacters } from "./attachments"
import type { ExtractedText } from "./read-attachment"

export async function readPdf(data: ArrayBuffer): Promise<ExtractedText> {
  const port = new Worker(workerUrl, { type: "module" })
  const worker = PDFWorker.create({ port })
  const task = getDocument({
    data, worker, cMapUrl: chrome.runtime.getURL("pdf-cmaps/"), cMapPacked: true,
    disableFontFace: true, useSystemFonts: false, isEvalSupported: false, useWasm: false,
  })
  try {
    const pdf = await task.promise
    const lastPage = Math.min(pdf.numPages, 100)
    let text = ""
    for (let number = 1; number <= lastPage; number += 1) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const lines = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join("").trim()
      page.cleanup()
      if (!lines) continue
      text += (text ? "\n\n" : "") + "第 " + number + " 页\n" + lines
      if (text.length > maxDocumentCharacters) return { text, truncated: true }
    }
    if (!text) throw new Error("PDF 没有可提取的文字，可截取需要的页面后以图片添加")
    return { text, truncated: lastPage < pdf.numPages }
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new Error("PDF 已加密，请添加解密后的副本")
    throw error
  } finally {
    try {
      await task.destroy()
    } finally {
      worker.destroy()
      port.terminate()
    }
  }
}
