import { memo, useEffect, useState, type ReactNode } from "react"
import Markdown from "react-markdown"
import { replyMarkdown } from "../../src/agent/report"
import { getExtensionName } from "../../src/extension-name"
import { requestsMarkdown } from "../../src/run/intent"
import type { RunState } from "../../src/run/state"
import { ChatIcon } from "./chat-icon"

export function runLabel(run: RunState): string {
  if (run.status === "complete") {
    if (run.download?.state === "complete") return "已保存"
    if (run.download?.state === "pending" || run.download?.state === "in_progress") return "正在保存"
    if (run.download?.state === "unknown") return "保存待确认"
    if (run.download?.state === "interrupted") return "下载未完成"
    return run.answer ? "已回复" : "报告已就绪"
  }
  return {
    running: "运行中",
    paused: "已暂停",
    needs_user: "等待接管",
    partial: "部分结果",
    interrupted: "已中断",
  }[run.status]
}

function safeHref(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? url.href : ""
  } catch {
    return ""
  }
}

const Reply = memo(function Reply({ text, streaming }: { text: string; streaming?: boolean }) {
  return <div className={streaming ? "reply reply-preview" : "reply"}>
    <Markdown skipHtml disallowedElements={["img"]} urlTransform={safeHref}
      components={{ a: ({ href, children }) => href
        ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
        : <span>{children}</span> }}>
      {text}
    </Markdown>
  </div>
})

const backgroundEvents = new Set(["开始任务", "收到消息", "模型返回", "已保存 Markdown", "请求保存 Markdown", "下载未完成", "已清理任务标签页"])

function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (!seconds) return "不到 1 秒"
  if (seconds < 60) return seconds + " 秒"
  return Math.floor(seconds / 60) + " 分 " + seconds % 60 + " 秒"
}

function actionLabel(label: string, detail?: string) {
  if (label === "操作查询控件") return detail?.startsWith("搜索") ? "网页搜索" : "操作网页"
  if (label === "验收报告") return "核对结果"
  if (label === "采集来源") return "收集来源"
  return label
}

function RunProcess({ run, replying, children }: { run: RunState; replying: boolean; children?: ReactNode }) {
  const running = run.status === "running"
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const activity = run.events.filter(event => !backgroundEvents.has(event.label))
  const plan = run.planSummary || (run.query
    ? "围绕「" + run.query + "」查找 " + run.criteria.sourceCount + " 条资料，并核对来源。"
    : "")
  const active = running ? run.inFlight : undefined
  const elapsed = (run.activeDurationMs ?? (running ? 0 : run.updatedAt - run.createdAt)) +
    (running ? Math.max(0, now - (run.activeSince ?? run.createdAt)) : 0)
  const action = active ? actionLabel(active.label) : undefined
  const progress = active?.label === "操作查询控件" && active.detail
    ? "正在搜索「" + active.detail + "」"
    : action ? "正在" + action : replying ? "正在回复" : "正在思考"
  const status = runLabel(run)
  const expandable = running || Boolean(activity.length || plan || children)
  const line = <>
    {running && <span className="process-dot" aria-hidden="true" />}
    <span className="process-title" role={running ? "status" : undefined}>
      {running ? progress : "用时 " + elapsedLabel(elapsed)}
    </span>
    {expandable && <span className="process-chevron"><ChatIcon name="chevron" size={13} /></span>}
    {running && elapsed >= 1000 && <span className="process-outcome" aria-hidden="true">{elapsedLabel(elapsed)}</span>}
    {!running && status !== "已回复" && <span className="process-outcome" role="status">{status}</span>}
  </>

  if (!expandable) return <div className="process-row">{line}</div>
  return <details className="process" aria-label="思考摘要与操作记录">
    <summary className="process-row" title="查看思考摘要与操作记录">{line}</summary>
    <div className="process-body">
      {plan && <p className="process-plan">{plan}</p>}
      {(activity.length > 0 || active) && <ol className="activity" aria-label="操作记录">
        {activity.map(event => <li key={event.id} className={event.outcome === "rejected" || event.outcome === "unknown" ? "activity-warning" : undefined}>
          <span className="activity-dot" aria-hidden="true" />
          <div><strong>{actionLabel(event.label, event.detail)}</strong>{event.detail && <small>{event.detail}</small>}</div>
        </li>)}
        {active && <li className="activity-running">
          <span className="activity-dot" aria-hidden="true" />
          <div><strong>{progress}</strong>{active.detail && active.label !== "操作查询控件" && <small>{active.detail}</small>}</div>
        </li>}
      </ol>}
      {running && !plan && !activity.length && !active && <p className="process-note">正在根据你的消息准备回复。</p>}
      {children}
    </div>
  </details>
}

interface Props {
  run: RunState
  preview?: string
  current: boolean
  live: boolean
  busy: boolean
  takeOver: () => void
  resume: () => void
  authorize: () => void
  focus: (pageId?: string) => void
  save: () => void
  cleanup: () => void
}

export function RunView({ run, preview, current, live, busy, takeOver, resume, authorize, focus, save, cleanup }: Props) {
  const [copyStatus, setCopyStatus] = useState("")
  const running = run.status === "running"
  const downloadable = run.download?.state !== "pending" && run.download?.state !== "in_progress"
  const taskPages = run.pages.filter(page => page.role === "task")
  const waiting = busy || Boolean(run.inFlight)
  const resumable = current && live && !running && run.status !== "complete" && run.status !== "interrupted"
  const canFocus = live && run.focusTabId !== undefined && run.status !== "interrupted" &&
    (run.status !== "complete" || !taskPages.length)
  const reply = run.answer ?? run.report?.markdown
  const liveReply = running && !run.inFlight ? preview : undefined
  const file = reply && (run.download || requestsMarkdown(run.task))
  const canTakeOver = running && canFocus && !liveReply
  const canOpenPage = !running && canFocus

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus("已复制")
    } catch {
      setCopyStatus("复制失败")
    }
  }

  return <article className="assistant-message" aria-label={getExtensionName() + " 回复"}>
    <RunProcess run={run} replying={Boolean(liveReply)}>
      {live && taskPages.length > 0 && <div className="task-pages">
        <details>
          <summary>任务标签页 · {taskPages.length}</summary>
          <ul aria-label="本次任务打开的标签页">
            {taskPages.map(page => {
              const url = new URL(page.url ?? page.observation?.url ?? page.origin)
              const path = url.pathname === "/" ? "" : url.pathname
              const label = page.title === url.hostname ? path || url.host : page.title
              const location = label === path ? url.host : url.host + path
              return <li key={page.id}>
                <button type="button" className="task-page" disabled={running || waiting}
                  title={url.host + path} onClick={() => focus(page.id)}>
                  <span>{label}</span>{label !== location && <small>{location}</small>}
                </button>
              </li>
            })}
          </ul>
        </details>
        {!running && <button className="small plain" disabled={waiting} onClick={cleanup}>关闭任务标签页</button>}
      </div>}
    </RunProcess>
    {run.reason && <p className="notice warning">{run.reason}</p>}
    {(resumable || canTakeOver || (canOpenPage && !reply)) && <div className="actions run-actions">
      {canTakeOver && <button className="plain small" disabled={busy} onClick={takeOver}>接管网页</button>}
      {resumable && run.requestedOrigin &&
        <button className="primary" disabled={busy} onClick={authorize}>授权并继续</button>}
      {resumable && !run.requestedOrigin &&
        <button className="primary" disabled={waiting} onClick={resume}>继续任务</button>}
      {canOpenPage && (resumable || !reply) && <button className="secondary" disabled={waiting} onClick={() => focus()}>
        {run.pageAction ? "打开原页" : "打开当前页"}
      </button>}
    </div>}
    {liveReply
      ? <Reply text={liveReply} streaming />
      : reply && <Reply text={reply} />}
    {reply && !running && <div className="reply-actions">
      <button type="button" className="icon-button copy-reply" aria-label="复制回复" title={copyStatus || "复制回复"} onClick={() => void copy(reply)}>
        <ChatIcon name={copyStatus === "已复制" ? "check" : "copy"} />
      </button>
      {!file && <button className="plain small" disabled={busy} onClick={save}>保存 Markdown</button>}
      {canOpenPage && !resumable && <button className="plain small" disabled={waiting} onClick={() => focus()}>
        {run.pageAction ? "打开原页" : "打开当前页"}
      </button>}
      {copyStatus && <small role="status">{copyStatus}</small>}
    </div>}
    {file && <div className="artifact">
      <div className="file-heading"><span className="file-mark" aria-hidden="true">MD</span>
        <div><strong>Markdown 文件</strong><p className="file-name">
          {run.download?.filename?.split(/[\\/]/).pop() || run.report?.filename ||
            replyMarkdown(run.id, run.task, reply).filename}</p></div>
      </div>
      <div className="actions">
        <button className="secondary" disabled={busy || running || !downloadable} onClick={save}>另存为</button>
        {run.download?.state === "complete" && run.download.id !== undefined &&
          <button className="secondary" onClick={() => chrome.downloads.show(run.download!.id!)}>在文件夹中显示</button>}
      </div>
    </div>}
  </article>
}
