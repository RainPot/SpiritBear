import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { attachmentBudgetError, maxAttachments, type ChatAttachment } from "../../src/agent/attachments"
import { reasoningLevels, type ReasoningEffort } from "../../src/agent/model-options"
import { readAttachment } from "../../src/agent/read-attachment"
import type { ModelChoice, ModelConnection } from "../../src/agent/settings"
import { pageOrigin } from "../../src/browser/urls"
import { requestsMarkdown } from "../../src/run/intent"
import { pageActionLabels, type PageRef, type StartInput } from "../../src/run/state"
import { readRunAttachments } from "../../src/run/store"
import { AttachmentList, AttachmentPreview } from "./attachment-view"
import { ChatIcon } from "./chat-icon"
import { useLanguage } from "./language"

export type ComposeMessage = Omit<StartInput, "provider" | "model" | "previousRunId" | "windowId" | "uiLanguage"> & { windowId?: number }
type AttachmentIssue = { message: string; name?: string }

interface Props {
  busy: boolean
  hidden: boolean
  running: boolean
  connections: ModelConnection[]
  model?: ModelChoice
  previousAttachmentsRunId?: string
  onModel: (model: ModelChoice) => void
  onEffort: (model: ModelChoice, effort?: ReasoningEffort) => void
  onSettings: () => void
  onPause: () => void
  onSend: (message: ComposeMessage) => void
}

const mentionPattern = /@([^@\s，。]*)$/

function tabReference(tab: chrome.tabs.Tab): PageRef | undefined {
  const origin = pageOrigin(tab.url ?? "")
  if (!origin || tab.id === undefined || tab.incognito) return
  return { tabId: tab.id, origin, title: tab.title || new URL(origin).hostname }
}

const effortLabels: Record<ReasoningEffort, string> = {
  none: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
}

const modelKey = (choice: ModelChoice) => JSON.stringify([choice.provider, choice.model])

export function Compose({ busy, hidden, running, connections, model, previousAttachmentsRunId, onModel, onEffort, onSettings, onPause, onSend }: Props) {
  const { language, t } = useLanguage()
  const [task, setTask] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [showUrl, setShowUrl] = useState(false)
  const [refs, setRefs] = useState<PageRef[]>([])
  const [tabs, setTabs] = useState<PageRef[]>([])
  const [activeTab, setActiveTab] = useState<{ page: PageRef; windowId: number }>()
  const [dismissedTab, setDismissedTab] = useState<number>()
  const [windowId, setWindowId] = useState<number>()
  const [picker, setPicker] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [mention, setMention] = useState<{ start: number; end: number; term: string }>()
  const [focused, setFocused] = useState(0)
  const [pickerError, setPickerError] = useState("")
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<AttachmentIssue[]>([])
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<ChatAttachment>()
  const editor = useRef<HTMLTextAreaElement>(null)
  const attachmentButton = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const readingLock = useRef(false)
  const focusWhenReady = useRef(true)

  const term = mention?.term.toLowerCase() ?? ""
  const current = activeTab && activeTab.page.tabId !== dismissedTab ? activeTab.page : undefined
  const auto = current && refs.length < 12 && !refs.some(ref => ref.tabId === current.tabId) ? current : undefined
  const available = connections.filter(item => item.connected)
  const levels = model ? reasoningLevels(model.provider, model.model) : []
  const reasoning = available.find(item => item.profile.id === model?.provider)?.reasoning
  const effort = model && reasoning && Object.hasOwn(reasoning, model.model) ? reasoning[model.model] : undefined
  const deepseek = model?.provider === "deepseek"
  const matches = tabs.filter(tab => !refs.some(ref => ref.tabId === tab.tabId) &&
    (tab.title.toLowerCase().includes(term) || tab.origin.includes(term))).slice(0, 10)

  useEffect(() => {
    let lookup = 0
    function refresh() {
      const request = ++lookup
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (request !== lookup) return
        const page = tab && tabReference(tab)
        setActiveTab(page ? { page, windowId: tab.windowId } : undefined)
      }, () => { if (request === lookup) setActiveTab(undefined) })
    }
    function updated(_id: number, changes: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
      if (tab.active && (changes.url !== undefined || changes.title !== undefined)) refresh()
    }
    chrome.tabs.onActivated.addListener(refresh)
    chrome.tabs.onUpdated.addListener(updated)
    refresh()
    return () => {
      lookup += 1
      chrome.tabs.onActivated.removeListener(refresh)
      chrome.tabs.onUpdated.removeListener(updated)
    }
  }, [])

  useEffect(() => {
    if (hidden || busy || !focusWhenReady.current) return
    if (document.hasFocus()) editor.current?.focus()
    focusWhenReady.current = false
  }, [hidden, busy])

  useLayoutEffect(() => {
    const field = editor.current
    if (hidden || !field) return
    field.style.height = "auto"
    field.style.height = Math.min(field.scrollHeight, 122) + "px"
  }, [hidden, task, language])

  async function openPicker() {
    setAttachmentOpen(false)
    setPicker(true)
    setFocused(0)
    setPickerError("")
    try {
      const current = await chrome.windows.getCurrent()
      if (current.id === undefined || current.incognito || current.type !== "normal") throw new Error("请在普通 Chrome 窗口选择标签页")
      const opened = await chrome.tabs.query({ windowId: current.id })
      setWindowId(current.id)
      setTabs(opened.map(tabReference).filter(ref => ref !== undefined))
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "读取标签页列表失败")
    }
  }

  function choose(tab: PageRef) {
    if (refs.length >= 12) return
    setRefs(current => current.some(ref => ref.tabId === tab.tabId) ? current : [...current, tab])
    if (mention) {
      const { start, end } = mention
      setTask(current => current.slice(0, start) + current.slice(end))
      requestAnimationFrame(() => editor.current?.setSelectionRange(start, start))
    }
    setMention(undefined)
    setPicker(false)
    editor.current?.focus()
  }

  async function addAttachments(load: (limit: number) => Promise<{ items: ChatAttachment[]; errors?: AttachmentIssue[] }>) {
    if (busy || readingLock.current) return
    const remaining = maxAttachments - attachments.length
    if (!remaining) {
      setAttachmentErrors([{ message: "每条消息最多添加 " + maxAttachments + " 个附件" }])
      return
    }
    readingLock.current = true
    setReading(true)
    setAttachmentErrors([])
    try {
      const { items, errors = [] } = await load(remaining)
      const next = [...attachments]
      for (const item of items) {
        if (next.some(existing => existing.id === item.id)) continue
        const error = attachmentBudgetError([...next, item])
        if (error) errors.push({ message: error })
        else next.push(item)
      }
      setAttachments(next)
      setAttachmentErrors(errors)
    } catch (error) {
      setAttachmentErrors([{ message: error instanceof Error ? error.message : "读取附件失败" }])
    } finally {
      readingLock.current = false
      setReading(false)
    }
  }

  function addFiles(files: File[], pasted = false) {
    if (!files.length) return
    void addAttachments(async limit => {
      const items: ChatAttachment[] = []
      const errors: AttachmentIssue[] = []
      for (const file of files.slice(0, limit)) {
        try {
          items.push(await readAttachment(file, pasted, language))
        } catch (error) {
          errors.push({ name: file.name.slice(0, 80), message: error instanceof Error ? error.message : "读取失败" })
        }
      }
      if (files.length > limit) errors.push({ message: "其余文件可在下一条消息添加" })
      return { items, errors }
    })
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy || running || readingLock.current || (!task.trim() && !attachments.length)) return
    onSend({
      task: task.trim() || t("请阅读附件并概括主要内容。"),
      references: refs, attachments: attachments.length ? attachments : undefined,
      currentPage: current, startUrl, windowId: windowId ?? activeTab?.windowId,
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (picker) {
      if (event.key === "Escape") setPicker(false)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        if (matches.length) setFocused(current => (current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length)
      }
      if (event.key === "Enter") {
        event.preventDefault()
        const selected = matches[focused]
        if (selected) choose(selected)
      }
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return <div className="composer" hidden={hidden}>
    {activeTab && !running && !task && !refs.length && !attachments.length && !reading && !startUrl && !picker &&
      <div className="page-shortcuts" role="group" aria-label={t("网页快捷操作")}>
        {(["summarize", "translate"] as const).map(action =>
          <button key={action} type="button" className="plain small" disabled={busy}
            title={activeTab.page.title}
            onClick={() => onSend({
              task: t(pageActionLabels[action]), references: [activeTab.page], windowId: activeTab.windowId, pageAction: action,
            })}>
            {t(pageActionLabels[action])}
          </button>)}
      </div>}
    {picker && <div className="tab-picker" id="tab-options" role="listbox" aria-label={t("当前窗口标签页")}>
      {matches.map((tab, index) => <button type="button" role="option" id={"tab-option-" + tab.tabId} aria-selected={focused === index}
        className="tab-option" key={tab.tabId} onClick={() => choose(tab)}>
        <span>{tab.title}</span><small>{new URL(tab.origin).hostname}</small>
      </button>)}
      {!matches.length && <p className="empty">{t(pickerError || "当前窗口没有匹配的 HTTPS 标签页。")}</p>}
    </div>}
    <form className={dragging ? "compose is-dragging" : "compose"} onSubmit={submit}
      onPaste={event => {
        const files = Array.from(event.clipboardData.files)
        if (!files.length) return
        event.preventDefault()
        addFiles(files, true)
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        event.dataTransfer.dropEffect = busy || reading ? "none" : "copy"
        if (!busy && !reading) setDragging(true)
      }}
      onDragLeave={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false)
      }}
      onDrop={event => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setDragging(false)
        addFiles(Array.from(event.dataTransfer.files))
      }}>
      <input type="file" ref={fileInput} multiple hidden aria-label={t("选择本地附件")} onChange={event => {
        addFiles(Array.from(event.currentTarget.files ?? []))
        event.currentTarget.value = ""
      }} />
      <AttachmentList items={attachments} disabled={busy || reading}
        onOpen={id => setPreview(attachments.find(item => item.id === id))}
        onRemove={id => {
          setAttachments(items => items.filter(item => item.id !== id))
          setAttachmentErrors([])
        }} />
      {(reading || dragging) && <p className="attachment-status" role="status">{t(reading ? "正在读取附件…" : "松开以添加附件")}</p>}
      {!!attachments.length && !reading && !dragging && <p className="attachment-status">{t("附件随消息发送给所选模型")}</p>}
      {!!attachmentErrors.length && <p className="attachment-error" role="alert">
        {[...new Set(attachmentErrors.map(({ name, message }) => name ? name + " · " + t(message) : t(message)))].join(" ")}
      </p>}
      {(auto || refs.length > 0) && <ul className="reference-list" aria-label={t("已选参考标签页")}>
        {auto && <li>
          <span title={auto.title}><strong>{t("当前页")}</strong> · {auto.title}</span>
          <button type="button" aria-label={t("移除当前标签页")} onClick={() => setDismissedTab(auto.tabId)}><ChatIcon name="close" size={13} /></button>
        </li>}
        {refs.map(tab => <li key={tab.tabId}>
          <span title={tab.origin}>@ {tab.title}</span>
          <button type="button" aria-label={t("移除 {name}", { name: tab.title })} onClick={() => {
            if (tab.tabId === current?.tabId) setDismissedTab(tab.tabId)
            setRefs(items => items.filter(ref => ref.tabId !== tab.tabId))
          }}><ChatIcon name="close" size={13} /></button>
        </li>)}
      </ul>}
      {showUrl && <label className="field url-field">{t("起始网址")}
        <input type="url" value={startUrl} onChange={event => setStartUrl(event.target.value)} placeholder="https://example.com" disabled={busy} />
      </label>}
      <textarea ref={editor} aria-label={t("任务指令")} value={task} maxLength={6000} disabled={busy}
        aria-controls={picker ? "tab-options" : undefined} rows={1}
        aria-activedescendant={picker && matches[focused] ? "tab-option-" + matches[focused].tabId : undefined}
        placeholder={t(running ? "可以先写下一条消息" : "发消息，或粘贴截图")}
        onKeyDown={onKeyDown}
        onChange={event => {
          const value = event.target.value
          const end = event.target.selectionStart
          const found = mentionPattern.exec(value.slice(0, end))
          setTask(value)
          setFocused(0)
          if (found && refs.length < 12) {
            setMention({ start: end - found[0].length, end, term: found[1] ?? "" })
            if (!picker) void openPicker()
          } else {
            setMention(undefined)
            setPicker(false)
          }
        }} />
      {requestsMarkdown(task) && <p className="export-intent">{t("完成后自动下载 Markdown")}</p>}
      <div className="composer-footer">
        <div className="composer-tools" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setAttachmentOpen(false)
        }} onKeyDown={event => {
          if (event.key === "Escape") {
            setAttachmentOpen(false)
            attachmentButton.current?.focus()
          }
        }}>
          <button ref={attachmentButton} type="button" className="plain small add-context" disabled={busy || reading}
            title={t("添加截图、文件、标签页或网址")} aria-label={t("添加附件")} aria-expanded={attachmentOpen}
            onClick={() => { setPicker(false); setAttachmentOpen(!attachmentOpen) }}>
            <ChatIcon name="add" size={17} /><span>{t("附件")}</span>
          </button>
          {attachmentOpen && <div className="attachment-menu" role="group" aria-label={t("添加附件和网页")}>
            <button type="button" className="plain" onClick={() => {
              setAttachmentOpen(false)
              fileInput.current?.click()
            }}>{t("添加截图或文件")}</button>
            {previousAttachmentsRunId && <button type="button" className="plain" onClick={() => {
              setAttachmentOpen(false)
              void addAttachments(async () => {
                const items = await readRunAttachments(previousAttachmentsRunId)
                return { items, errors: items.length ? [] : [{ message: "本地附件已清除" }] }
              })
            }}>{t("复用上次附件")}</button>}
            <button type="button" className="plain" disabled={refs.length >= 12}
              onClick={() => { void openPicker(); editor.current?.focus() }}>{t("@ 标签页")}</button>
            <button type="button" className="plain" onClick={() => {
              setAttachmentOpen(false)
              setShowUrl(!showUrl)
            }}>{t(showUrl ? "隐藏网址" : "添加网址")}</button>
          </div>}
        </div>
        <div className={"send-group" + (levels.length ? " has-reasoning" : "")}>
          {model ? <select className="model-picker" aria-label={t("对话模型")} title={model.model} disabled={busy || running}
            value={modelKey(model)} onChange={event => {
              const [provider, model] = JSON.parse(event.target.value) as [ModelChoice["provider"], string]
              onModel({ provider, model })
            }}>
            {available.map(({ profile }) => <optgroup key={profile.id} label={profile.label}>
              {profile.models.map(model => <option key={model} value={modelKey({ provider: profile.id, model })}>{model}</option>)}
            </optgroup>)}
          </select> : <button type="button" className="plain small" disabled={busy} onClick={onSettings}>{t("连接模型")}</button>}
          {model && levels.length > 0 && <label className="reasoning-picker">
            <span>{t("思考")}</span>
            <select aria-label={t("思考强度")} title={t("思考强度")} disabled={busy || running}
              value={deepseek && effort === "none" ? "" : effort ?? ""}
              onChange={event => onEffort(model, (event.target.value || undefined) as ReasoningEffort | undefined)}>
              <option value="">{t(deepseek ? "关闭" : "默认")}</option>
              {levels.filter(level => !deepseek || level !== "none").map(level =>
                <option key={level} value={level}>{t(effortLabels[level])}</option>)}
            </select>
          </label>}
          {running ? <button type="button" className="send" title={t("暂停当前任务")} aria-label={t("暂停当前任务")} disabled={busy} onClick={onPause}>
            <ChatIcon name="stop" size={19} />
          </button> : <button className="send" type="submit" title={t("发送")} aria-label={t("发送")} disabled={busy || reading || (!task.trim() && !attachments.length)}>
            <ChatIcon name="send" size={18} />
          </button>}
        </div>
      </div>
    </form>
    {preview && <AttachmentPreview item={preview} onClose={() => setPreview(undefined)} />}
  </div>
}
