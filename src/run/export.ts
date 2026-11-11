import type { PanelClient } from "./client"
import type { RunState } from "./state"

export async function saveMarkdown(client: PanelClient, runId: string, automatic: boolean): Promise<RunState> {
  const run = await client.request<RunState>({ kind: "export_start", id: runId, automatic })
  if (!run.report || !run.download) throw new Error("报告尚未就绪")
  const { report, download } = run
  const url = URL.createObjectURL(new Blob([report.markdown], { type: "text/markdown;charset=utf-8" }))
  let downloadId: number
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename: "TabErrand/" + report.filename,
      conflictAction: "uniquify",
      saveAs: !automatic,
    })
  } catch {
    return client.request<RunState>({ kind: "export_record", id: runId, attempt: download.attempt })
  } finally {
    // 下载创建回执到达后，保留 Blob 一段时间供 Chrome 读取。
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return client.request<RunState>({ kind: "export_record", id: runId, attempt: download.attempt, downloadId })
}
