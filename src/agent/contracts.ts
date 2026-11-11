import { z } from "zod"

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
const label = z.string().trim().min(1).max(120)
const element = z.strictObject({ pageId: id, observationId: id, elementId: id })

export const reportSchema = z.strictObject({
  title: label,
  sections: z.array(z.strictObject({
    heading: label,
    items: z.array(z.strictObject({
      text: z.string().trim().min(1).max(600),
      evidenceIds: z.array(id).min(1).max(20),
    })).min(1).max(12),
  })).min(1).max(8),
})
export type ReportDraft = z.infer<typeof reportSchema>

const schemas = {
  plan_task: z.strictObject({
    query: label,
    sourceCount: z.number().int().min(1).max(20),
    topics: z.array(label).max(8),
    summary: z.string().trim().min(1).max(180).optional(),
  }),
  open_page: z.strictObject({
    fromPageId: id.optional(),
    link: element.optional(),
    url: z.string().url().regex(/^https:\/\//i).max(2048).optional(),
  }),
  observe_page: z.strictObject({ pageId: id }),
  interact: z.strictObject({
    pageId: id,
    observationId: id,
    action: z.enum(["search", "click", "choose", "scroll"]),
    elementId: id.optional(),
    value: z.string().max(180).optional(),
    direction: z.enum(["up", "down"]).optional(),
  }),
  collect_source: z.strictObject({ pageId: id, observationId: id }),
  finish_report: reportSchema,
  pause_task: z.strictObject({ pageId: id.optional(), reason: label }),
}

const toolDescriptions: Record<keyof typeof schemas, string> = {
  plan_task: "记录用户要检索的主题、来源数量和明确要求的报告标题。summary 可用一句给用户看的话说明准备查什么、如何核对。只记录一次。",
  open_page: "新建任务页。仅提供一个参数：复制指定页 fromPageId，打开观察中的链接 link，或访问用户授权站点的 HTTPS 地址 url。",
  observe_page: "读取指定页的可见正文、链接和查询控件。导航或页面变化后重新观察。",
  interact: "在任务页操作最近观察。search 使用搜索框 elementId 与 value 输入并尝试查询。click 点击查询控件。choose 使用下拉控件和选项 value。scroll 使用 direction。",
  collect_source: "将当前已打开页面的正文登记为引用。提供最近观察的 observationId，使用返回的证据 ID。",
  finish_report: "提交按主题整理的报告。每条归纳需使用 collect_source 返回的证据 ID。",
  pause_task: "需要用户登录、处理验证码或接管时暂停，并指明页面与原因。",
}

export type ToolName = keyof typeof schemas
export type ToolCall = { [K in ToolName]: { name: K; args: z.infer<(typeof schemas)[K]> } }[ToolName]
export type ToolDefinition = {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export const modelTools: ToolDefinition[] = (Object.keys(schemas) as ToolName[]).map(name => {
  const parameters = z.toJSONSchema(schemas[name])
  delete parameters.$schema
  return { type: "function", function: { name, description: toolDescriptions[name], parameters } }
})

export function parseToolCall(name: string, raw: string): ToolCall {
  if (!Object.hasOwn(schemas, name)) throw new Error("模型请求了未知工具")
  if (raw.length > 100_000) throw new Error("工具参数过长")
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    throw new Error("工具参数不是有效 JSON")
  }
  const toolName = name as ToolName
  const result = schemas[toolName].safeParse(input)
  if (!result.success) throw new Error("工具参数不符合 " + toolName + " 的定义")
  return { name: toolName, args: result.data } as ToolCall
}

const chineseDigits = "零一二三四五六七八九"

export function requestedSourceCount(prompt: string): number | undefined {
  const found = /(?:^|[^\d])(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*(?:条|篇|份|个)\s*(?:(?:不同|相关|独立|公开|正式|官方|有效|真实)(?:的)?\s*){0,3}(?:笔记|来源|资料|材料|文章|记录|结果|文档|原文|链接|帖子|网页|[\p{L}]{0,12}面经)/u.exec(prompt)
  if (!found?.[1]) return
  const text = found[1].replaceAll("两", "二")
  let count = Number(text)
  if (Number.isNaN(count)) {
    const [tens = "", units] = text.split("十")
    count = units === undefined ? chineseDigits.indexOf(tens) :
      (tens ? chineseDigits.indexOf(tens) : 1) * 10 + (units ? chineseDigits.indexOf(units) : 0)
  }
  return Number.isInteger(count) && count > 0 ? count : undefined
}
