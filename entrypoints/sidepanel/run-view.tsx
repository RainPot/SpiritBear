import Markdown from "react-markdown"
import { replyMarkdown } from "../../src/agent/report"
import { requestsMarkdown } from "../../src/run/intent"
import type { RunState } from "../../src/run/state"

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

function Reply({ text }: { text: string }) {
  return <div className="reply">
    <Markdown skipHtml disallowedElements={["img"]} urlTransform={safeHref}
      components={{ a: ({ href, children }) => href
        ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
        : <span>{children}</span> }}>
      {text}
    </Markdown>
  </div>
}

interface Props {
  run: RunState
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

export function RunView({ run, current, live, busy, takeOver, resume, authorize, focus, save, cleanup }: Props) {
  const running = run.status === "running"
  const downloadable = run.download?.state !== "pending" && run.download?.state !== "in_progress"
  const activity = run.events.filter(event => !["开始任务", "收到消息", "模型返回"].includes(event.label))
  const newestAction = activity.at(-1)
  const taskPages = run.pages.filter(page => page.role === "task")
  const waiting = busy || Boolean(run.inFlight)
  const resumable = current && live && !running && run.status !== "complete" && run.status !== "interrupted"
  const canFocus = live && run.focusTabId !== undefined && run.status !== "interrupted" &&
    (run.status !== "complete" || !taskPages.length)
  const reply = run.answer ?? run.report?.markdown
  const file = reply && (run.download || requestsMarkdown(run.task))
  return <article className="assistant-message" aria-label="TabErrand 回复">
    <div className="assistant-head">
      <span className="mark mini" aria-hidden="true" /><strong>TabErrand</strong>
      <span className={"status" + (run.download?.state === "complete" ? " success" : running ? " active" : "")}
        role="status">{runLabel(run)}</span>
    </div>
    {running && <p className="working" aria-live="polite">{newestAction
      ? [newestAction.label, newestAction.detail].filter(Boolean).join(" · ")
      : "正在准备回复…"}</p>}
    {run.reason && <p className="notice warning">{run.reason}</p>}
    {(resumable || canFocus) && <div className="actions">
      {running && canFocus && <button className="secondary" disabled={busy} onClick={takeOver}>接管网页</button>}
      {resumable && run.requestedOrigin &&
        <button className="primary" disabled={busy} onClick={authorize}>授权并继续</button>}
      {resumable && !run.requestedOrigin &&
        <button className="primary" disabled={waiting} onClick={resume}>继续任务</button>}
      {!running && canFocus && <button className="secondary" disabled={waiting} onClick={() => focus()}>
        {run.pageAction ? "打开原页" : "打开当前页"}
      </button>}
    </div>}
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
    {!!activity.length && <details className="activity">
      <summary>执行记录{run.evidence.length
        ? " · " + run.evidence.length + " 条来源" : ""}</summary>
      <ol>
        {activity.map(event => <li key={event.id}>
          <i className={event.outcome === "rejected" || event.outcome === "unknown" ? "warn-dot" : ""} aria-hidden="true" />
          <span><strong>{event.label}</strong>{event.detail && <small>{event.detail}</small>}</span>
        </li>)}
      </ol>
    </details>}
    {reply && <Reply text={reply} />}
    {reply && !file && !running && <div className="reply-actions">
      <button className="plain small" disabled={busy} onClick={save}>保存 Markdown</button>
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
