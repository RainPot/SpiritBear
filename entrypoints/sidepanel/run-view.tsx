import type { RunState } from "../../src/run/state"

export function runLabel(run: RunState): string {
  if (run.status === "complete") {
    if (run.download?.state === "complete") return "已保存"
    if (run.download?.state === "pending" || run.download?.state === "in_progress") return "正在保存"
    if (run.download?.state === "unknown") return "保存待确认"
    if (run.download?.state === "interrupted") return "下载未完成"
    return "报告已就绪"
  }
  return {
    running: "运行中",
    paused: "已暂停",
    needs_user: "等待接管",
    partial: "部分结果",
    interrupted: "已中断",
  }[run.status]
}

interface Props {
  run: RunState
  busy: boolean
  pause: () => void
  resume: () => void
  authorize: () => void
  focus: () => void
  save: () => void
  cleanup: () => void
  create: () => void
}

export function RunView({ run, busy, pause, resume, authorize, focus, save, cleanup, create }: Props) {
  const running = run.status === "running"
  const downloadable = run.download?.state !== "pending" && run.download?.state !== "in_progress"
  const lastEvents = run.events.slice(-12).reverse()
  return <>
    <section className="card run">
      <div className="section-heading">
        <div><h1>任务进度</h1><p>{run.query || run.task}</p></div>
        <span className={"status " + (run.download?.state === "complete" ? "success" : running ? "active" : "")}
          role="status">{runLabel(run)}</span>
      </div>
      <div className="run-summary">
        <span>来源 <strong>{run.evidence.length} / {run.criteria.sourceCount}</strong></span>
        <span>任务页 <strong>{run.pages.filter(page => page.role === "task").length}</strong></span>
      </div>
      {run.reason && <p className="notice warning">{run.reason}</p>}
      <div className="actions">
        {running && <button className="primary" onClick={pause}>暂停任务</button>}
        {!running && run.requestedOrigin &&
          <button className="primary" disabled={busy} onClick={authorize}>授权并继续</button>}
        {!running && !run.requestedOrigin && run.status !== "complete" && run.status !== "interrupted" &&
          <button className="primary" disabled={busy || Boolean(run.inFlight)} onClick={resume}>继续任务</button>}
        {run.focusTabId !== undefined && run.status !== "interrupted" &&
          <button className="secondary" disabled={busy} onClick={focus}>打开当前页</button>}
        {!running && <button className="secondary" disabled={busy} onClick={create}>新任务</button>}
      </div>
      <details className="activity" open>
        <summary>运行记录</summary>
        <ol>
          {lastEvents.map(event => <li key={event.id}>
            <i className={event.outcome === "rejected" || event.outcome === "unknown" ? "warn-dot" : ""} aria-hidden="true" />
            <span><strong>{event.label}</strong>{event.detail && <small>{event.detail}</small>}</span>
          </li>)}
        </ol>
      </details>
      {!running && run.status !== "interrupted" && run.pages.some(page => page.role === "task") &&
        <button className="small plain" disabled={busy || Boolean(run.inFlight)} onClick={cleanup}>关闭任务标签页</button>}
    </section>
    {run.report && <section className="card artifact">
      <div className="section-heading">
        <div><h2>Markdown 报告</h2>
          <p className="file-name">{run.download?.filename?.split(/[\\/]/).pop() || run.report.filename}</p></div>
        <span className="file-mark" aria-hidden="true">MD</span>
      </div>
      {run.report.gaps.length > 0 && <ul className="gaps">{run.report.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
      <div className="actions">
        <button className="secondary" disabled={busy || running || !downloadable} onClick={save}>另存为</button>
        {run.download?.state === "complete" && run.download.id !== undefined &&
          <button className="secondary" onClick={() => chrome.downloads.show(run.download!.id!)}>在文件夹中显示</button>}
      </div>
      <details className="preview"><summary>预览 Markdown</summary><pre>{run.report.markdown}</pre></details>
      {run.report.sources.length > 0 && <ol className="sources" aria-label="报告来源">
        {run.report.sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a></li>)}
      </ol>}
    </section>}
  </>
}
