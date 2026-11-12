import { maxDocumentBytes, maxDocumentCharacters, maxImageBytes, type ChatAttachment } from "./attachments"

export interface ExtractedText {
  text: string
  truncated?: boolean
}

function imageType(bytes: Uint8Array): string | undefined {
  const signature = String.fromCharCode(...bytes)
  if (signature.startsWith("\x89PNG\r\n\x1a\n")) return "image/png"
  if (signature.startsWith("\xff\xd8\xff")) return "image/jpeg"
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) return "image/gif"
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") return "image/webp"
}

function imageDataUrl(file: File, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("无法读取图片"))
    reader.readAsDataURL(file.slice(0, file.size, type))
  })
}

function decodeText(data: ArrayBuffer): string {
  const [first, second] = new Uint8Array(data, 0, Math.min(data.byteLength, 2))
  const decode = (encoding: string) => new TextDecoder(encoding, { fatal: true }).decode(data)
  if (first === 255 && second === 254) return decode("utf-16le")
  if (first === 254 && second === 255) return decode("utf-16be")
  try {
    return decode("utf-8")
  } catch {
    return decode("gb18030")
  }
}

async function readDocument(file: File): Promise<ExtractedText> {
  const data = await file.arrayBuffer()
  const extension = file.name.split(".").at(-1)?.toLowerCase()
  if (extension === "pdf" || file.type === "application/pdf") {
    return (await import("./read-pdf")).readPdf(data)
  }
  if (extension === "docx") return (await import("./read-office")).readWord(data)
  if (extension === "xlsx") return (await import("./read-office")).readWorkbook(data)
  let text: string
  try {
    text = decodeText(data)
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) throw new Error()
  } catch {
    throw new Error("请添加文本、PDF、DOCX、XLSX 或 PNG、JPEG、GIF、WebP 图片")
  }
  return { text }
}

export async function readAttachment(file: File, pasted = false): Promise<ChatAttachment> {
  if (!file.size) throw new Error("文件为空")
  if (file.size > maxDocumentBytes) throw new Error("文件超过 16 MB")
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const type = imageType(header)
  const filename = file.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180)
  const base = { id: crypto.randomUUID(), bytes: file.size }
  if (type) {
    if (file.size > maxImageBytes) throw new Error("图片超过 8 MB")
    const name = pasted ? "截图." + type.slice("image/".length).replace("jpeg", "jpg") : filename || "图片"
    return { ...base, name, kind: "image", content: await imageDataUrl(file, type) }
  }
  if (file.type.startsWith("image/")) throw new Error("请使用 PNG、JPEG、GIF 或 WebP 图片")
  const result = await readDocument(file)
  const text = result.text.trim()
  if (!text) throw new Error("没有可读正文")
  const truncated = result.truncated || text.length > maxDocumentCharacters
  return { ...base, name: filename || "本地文件", kind: "document", content: text.slice(0, maxDocumentCharacters), truncated }
}
