export const maxAttachments = 6
export const maxImageBytes = 8 * 1024 * 1024
export const maxDocumentBytes = 16 * 1024 * 1024
export const maxDocumentCharacters = 50_000
const maxImageCharacters = 16 * 1024 * 1024
const maxTextCharacters = 120_000

export interface AttachmentSummary {
  id: string
  name: string
  kind: "image" | "document"
  bytes: number
  truncated?: boolean
}

export interface ChatAttachment extends AttachmentSummary {
  content: string
}

export function attachmentBudgetError(items: ChatAttachment[]): string | undefined {
  if (items.length > maxAttachments) return "每条消息最多添加 " + maxAttachments + " 个附件"
  let images = 0
  let text = 0
  for (const item of items) {
    if (item.kind === "image") images += item.content.length
    else text += item.content.length
  }
  if (images > maxImageCharacters) return "截图和图片合计超过 12 MB，请分批发送"
  if (text > maxTextCharacters) return "附件正文合计超过 12 万字，请分批发送"
}

export function validateAttachments(items: ChatAttachment[]): void {
  if (!Array.isArray(items)) throw new Error("附件格式无效")
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 60 || ids.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 180 ||
        !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || typeof item.content !== "string" || !item.content.trim()) {
      throw new Error("附件格式无效")
    }
    if (item.kind === "image") {
      if (item.bytes > maxImageBytes || !/^data:image\/(?:png|jpeg|gif|webp);base64,/.test(item.content)) {
        throw new Error("图片格式无效或超过 8 MB")
      }
    } else if (item.kind !== "document" || item.bytes > maxDocumentBytes || item.content.length > maxDocumentCharacters) {
      throw new Error("附件正文超出读取范围")
    }
    ids.add(item.id)
  }
  const error = attachmentBudgetError(items)
  if (error) throw new Error(error)
}

export function attachmentSummary({ id, name, kind, bytes, truncated }: ChatAttachment): AttachmentSummary {
  return { id, name, kind, bytes, truncated }
}
