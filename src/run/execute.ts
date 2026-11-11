import { visibleAssistantText } from "../agent/completion-stream"
import type { ToolCall, ToolName } from "../agent/contracts"
import { buildReport } from "../agent/report"
import { getPage, NeedsUser, newTaskPage, pageUrl, sendToPage } from "../browser/browser"
import { requiresSearchBox, searchWasObserved } from "../browser/search-proof"
import type { RunState } from "./state"

interface Step {
  output: unknown
  detail?: string
  dispatched?: boolean
  update?: (run: RunState) => void
}

export const toolLabels: Record<ToolName, string> = {
  plan_task: "识别任务目标",
  open_page: "打开任务页",
  observe_page: "读取页面",
  interact: "操作查询控件",
  collect_source: "采集来源",
  finish_report: "验收报告",
  pause_task: "等待接管",
}

function requireField<T>(response: { ok: boolean } & Partial<Record<string, unknown>>, field: string): T {
  if (response.ok && field in response) return response[field] as T
  throw new Error(typeof response.reason === "string" ? response.reason : "页面没有返回预期结果")
}

export async function executeStep(run: RunState, tool: ToolCall): Promise<Step> {
  switch (tool.name) {
    case "plan_task": {
      if (run.query) return { output: { query: run.query, ...run.criteria }, detail: "沿用已有目标" }
      const { query, topics, sourceCount, summary } = tool.args
      const criteria = { sourceCount: run.fixedCount ?? sourceCount, topics: [...new Set(topics)] }
      return {
        output: { query, ...criteria },
        detail: query + " · " + criteria.sourceCount + " 条来源",
        update(current) {
          current.query = query
          current.planSummary = summary ? visibleAssistantText(summary).trim() || undefined : undefined
          current.criteria = criteria
        },
      }
    }
    case "open_page": {
      const { fromPageId, link, url } = tool.args
      if ([fromPageId, link, url].filter(Boolean).length !== 1) throw new Error("请选择一个页面来源")
      let target = url
      if (fromPageId) target = await pageUrl(run, getPage(run, fromPageId))
      if (link) {
        const response = await sendToPage(run, getPage(run, link.pageId), {
          kind: "link", observationId: link.observationId, elementId: link.elementId,
        })
        target = requireField<string>(response, "url")
      }
      if (!target) throw new Error("没有可用的页面地址")
      const opened = await newTaskPage(run, target)
      return {
        output: { pageId: opened.page.id, url: opened.url },
        detail: opened.page.origin,
        dispatched: true,
        update(current) {
          current.pages.push(opened.page)
          current.groupId = opened.groupId
          current.focusTabId = opened.page.tabId
        },
      }
    }
    case "observe_page": {
      const page = getPage(run, tool.args.pageId)
      const response = await sendToPage(run, page, { kind: "observe" })
      if (!response.ok || !("observation" in response)) {
        throw new Error(!response.ok ? response.reason : "页面没有返回观察")
      }
      const observation = response.observation
      if (observation.blocked) {
        throw new NeedsUser(observation.blocked === "login" ? "该页面需要登录。请打开页面处理后继续。" : "该页面要求验证。请打开页面处理后继续。", page.tabId)
      }
      return {
        output: { pageId: page.id, ...observation },
        detail: observation.title,
        update(current) {
          const target = getPage(current, page.id)
          target.title = observation.title
          target.url = observation.url
          const snapshot = { url: observation.url, text: observation.text.slice(0, 1200) }
          target.observation = snapshot
          const search = current.searchAttempt
          if (search?.pageId === page.id && searchWasObserved(search.query, search.before, snapshot)) {
            current.searchResult = { url: observation.url, title: observation.title }
            current.searchAttempt = undefined
          }
          current.focusTabId = target.tabId
        },
      }
    }
    case "interact": {
      const page = getPage(run, tool.args.pageId)
      if (page.role !== "task") throw new Error("参考页用于阅读，请先打开任务页再操作")
      const response = await sendToPage(run, page, { kind: "interact", ...tool.args })
      requireField(response, "dispatched")
      return {
        output: { outcome: "dispatched", pageId: page.id, message: "已派发，请读取最新页面判断结果" },
        detail: tool.args.action === "search" ? "搜索「" + tool.args.value + "」" : page.title,
        dispatched: true,
        update(current) {
          current.focusTabId = page.tabId
          if (tool.args.action === "search" && tool.args.value && page.observation) {
            current.searchAttempt = { pageId: page.id, query: tool.args.value, before: page.observation }
          }
        },
      }
    }
    case "collect_source": {
      const page = getPage(run, tool.args.pageId)
      const response = await sendToPage(run, page, { kind: "capture", observationId: tool.args.observationId })
      if (!response.ok || !("source" in response)) throw new Error(!response.ok ? response.reason : "没有可用的页面内容")
      const source = response.source
      if (source.blocked) throw new NeedsUser("页面需要登录或验证，处理后可继续采集", page.tabId)
      if (!source.text) throw new Error("页面没有可见正文")
      const previous = run.evidence.find(item => item.url === source.url)
      if (previous) return { output: previous, detail: "复用已采集来源 · " + previous.title }
      if (run.evidence.length >= 24) throw new Error("已达到来源采集上限，请整理现有来源")
      const evidence = {
        id: "S" + (run.evidence.length + 1),
        title: source.title,
        url: source.url,
        excerpt: source.text.slice(0, 2200),
        capturedAt: new Date().toISOString(),
      }
      return {
        output: evidence,
        detail: evidence.title,
        update(current) { current.evidence.push(evidence) },
      }
    }
    case "finish_report": {
      if (requiresSearchBox(run.task) && !run.searchResult) {
        const reason = "请使用页面搜索框查询，并重新观察搜索结果后再提交报告"
        return { output: { complete: false, error: reason }, detail: reason }
      }
      const report = buildReport(run.id, run.criteria, run.evidence, tool.args)
      return {
        output: { complete: report.complete, gaps: report.gaps, sources: report.sources.length },
        detail: report.complete ? "通过 · " + report.sources.length + " 条来源" : report.gaps.join("；"),
        update(current) {
          current.report = report
          if (current.status === "running") {
            current.status = report.complete ? "complete" : "partial"
            current.reason = report.complete ? undefined : report.gaps.join("；")
            current.owner = undefined
          }
        },
      }
    }
    case "pause_task": {
      const page = tool.args.pageId ? getPage(run, tool.args.pageId) : undefined
      throw new NeedsUser(tool.args.reason, page?.tabId ?? run.focusTabId)
    }
  }
}
