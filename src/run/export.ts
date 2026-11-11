import type { PanelClient } from "./client"
import type { MarkdownExport, RunState } from "./state"

export async function saveMarkdown(client: PanelClient, runId: string, automatic: boolean): Promise<RunState> {
  const { attempt, filename, markdown } = await client.request<MarkdownExport>({ kind: "export_start", id: runId, automatic })
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
  let downloadId: number
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename: "TabErrand/" + filename,
      conflictAction: "uniquify",
      saveAs: !automatic,
    })
  } catch {
    return client.request<RunState>({ kind: "export_record", id: runId, attempt })
  } finally {
    // 下载创建回执到达后，保留 Blob 一段时间供 Chrome 读取。
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return client.request<RunState>({ kind: "export_record", id: runId, attempt, downloadId })
}
