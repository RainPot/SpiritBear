import { useEffect, useRef } from "react"
import type { AttachmentSummary, ChatAttachment } from "../../src/agent/attachments"
import { ChatIcon } from "./chat-icon"
import { useLanguage } from "./language"

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB"
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB"
  return bytes + " B"
}

export function AttachmentList({ items, onOpen, onRemove, disabled }: {
  items: (AttachmentSummary | ChatAttachment)[]
  onOpen: (id: string) => void
  onRemove?: (id: string) => void
  disabled?: boolean
}) {
  const { t } = useLanguage()
  if (!items.length) return null
  return <ul className="attachments" aria-label={t("消息附件")}>
    {items.map(item => {
      const image = item.kind === "image"
      const thumbnail = image && "content" in item ? item.content : undefined
      return <li className="attachment" key={item.id}>
        <button type="button" className="attachment-open" aria-label={t("预览 {name}", { name: item.name })}
          title={item.name} onClick={() => onOpen(item.id)}>
          {thumbnail ? <img className="attachment-icon" src={thumbnail} alt="" /> :
            <span className="attachment-icon"><ChatIcon name={image ? "image" : "file"} size={16} /></span>}
          <span className="attachment-description">
            <span className="attachment-name">{item.name}</span>
            <small>{sizeLabel(item.bytes)}{item.truncated ? " · " + t("已截取") : ""}</small>
          </span>
        </button>
        {onRemove && <button type="button" className="icon-button attachment-remove" disabled={disabled}
          aria-label={t("移除 {name}", { name: item.name })} onClick={() => onRemove(item.id)}><ChatIcon name="close" size={13} /></button>}
      </li>
    })}
  </ul>
}

export function AttachmentPreview({ item, onClose }: { item: ChatAttachment; onClose: () => void }) {
  const { t } = useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="attachment-preview" aria-label={t("预览 {name}", { name: item.name })} onClose={onClose}>
    <div className="attachment-preview-header">
      <div><strong>{item.name}</strong><small>{sizeLabel(item.bytes)}{item.truncated ? " · " + t("正文已截取") : ""}</small></div>
      <button type="button" className="icon-button" aria-label={t("关闭附件预览")} onClick={() => dialog.current?.close()}>
        <ChatIcon name="close" />
      </button>
    </div>
    {item.kind === "image"
      ? <div className="attachment-preview-content"><img src={item.content} alt={item.name} /></div>
      : <pre className="attachment-preview-content">{item.content}</pre>}
  </dialog>
}
