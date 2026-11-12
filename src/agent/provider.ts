import { z } from "zod"
import { readCompletionStream, visibleAssistantText } from "./completion-stream"
import type { ToolDefinition } from "./contracts"

export type BuiltinProviderId = "openai" | "deepseek"
export type ProviderId = BuiltinProviderId | `custom:${string}`

export interface ProviderProfile {
  id: ProviderId
  baseUrl: string
  model: string
}

export const providers: Record<BuiltinProviderId, ProviderProfile> = {
  openai: { id: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  deepseek: { id: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
}

export const providerLabels = { openai: "OpenAI", deepseek: "DeepSeek" }

export function isBuiltinProvider(value: unknown): value is BuiltinProviderId {
  return value === "openai" || value === "deepseek"
}

export function isProviderId(value: unknown): value is ProviderId {
  return isBuiltinProvider(value) || (typeof value === "string" && /^custom:[a-z0-9-]{1,80}$/.test(value))
}

export function completionEndpoint(baseUrl: string): URL {
  const endpoint = new URL(baseUrl.trim())
  const loopback = endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)
  if ((endpoint.protocol !== "https:" && !loopback) || endpoint.username || endpoint.password) {
    throw new Error("API 地址须使用 HTTPS 或本机 HTTP，且不含凭据")
  }
  if (endpoint.search || endpoint.hash) throw new Error("API Base URL 请使用不含查询或片段的地址")
  const path = endpoint.pathname.replace(/\/+$/, "")
  endpoint.pathname = path.endsWith("/chat/completions") ? path : path + "/chat/completions"
  return endpoint
}

export function modelHostPattern(baseUrl: string): string {
  const endpoint = completionEndpoint(baseUrl)
  return endpoint.protocol + "//" + endpoint.hostname + "/*"
}

const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1).max(80),
    arguments: z.string().max(100_000),
  }),
})

export type ModelToolCall = z.infer<typeof toolCallSchema>

export type UserContent = string | (
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
)[]

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: UserContent }
  | { role: "assistant"; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface Completion {
  content: string | null
  tool_calls: ModelToolCall[]
  tokens?: number
}

const responseSchema = z.object({
  choices: z.tuple([z.object({
    message: z.object({
      content: z.string().nullable().optional(),
      tool_calls: z.array(toolCallSchema).max(20).nullish(),
    }),
  })], z.unknown()),
  usage: z.object({ total_tokens: z.number().optional() }).nullish(),
})

interface CompletionOptions {
  signal?: AbortSignal
  onText?: (text: string) => void
  namedTool?: string
}

export async function completeChat(
  profile: ProviderProfile,
  apiKey: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  { signal, onText, namedTool }: CompletionOptions = {},
): Promise<Completion> {
  const endpoint = completionEndpoint(profile.baseUrl)
  const deadline = AbortSignal.timeout(55_000)
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  const stream = Boolean(onText) && isBuiltinProvider(profile.id)
  let response: Response
  try {
    response = await fetch(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: requestSignal,
      body: JSON.stringify({
        model: profile.model,
        messages,
        ...(tools.length ? { tools } : {}),
        stream,
        ...(stream && endpoint.hostname === "api.openai.com" ? { stream_options: { include_usage: true } } : {}),
        ...(profile.id === "deepseek" ? { thinking: { type: "disabled" } } : {}),
        ...(namedTool ? { tool_choice: { type: "function", function: { name: namedTool } } } : {}),
      }),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(deadline.aborted ? "模型请求超时" : "连接模型 API 失败，请检查地址、权限和网络")
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("模型 API 拒绝鉴权，请检查 API Key 和模型访问权限")
    if (response.status === 429) throw new Error("模型 API 限流或配额不足")
    if (response.status === 402) throw new Error("模型 API 余额不足")
    if ([400, 415, 422].includes(response.status) && messages.some(message => message.role === "user" &&
        Array.isArray(message.content) && message.content.some(part => part.type === "image_url"))) {
      throw new Error("模型 API 返回 HTTP " + response.status + "，请确认所选模型支持图片输入")
    }
    throw new Error("模型 API 返回 HTTP " + response.status + "，请检查模型 ID 与工具调用支持")
  }

  let data: unknown
  const streaming = response.headers.get("content-type")?.includes("text/event-stream")
  try {
    data = streaming && response.body
      ? await readCompletionStream(response.body, onText)
      : await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (deadline.aborted) throw new Error("读取模型响应超时")
    throw new Error(streaming ? "模型流式回复中断或格式无效，请重试" : "模型 API 响应不是有效 JSON")
  }
  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) throw new Error("模型响应不符合 Chat Completions 工具协议")
  const message = parsed.data.choices[0].message
  const calls = message.tool_calls ?? []
  if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("模型返回了重复的工具调用 ID")
  return { content: message.content == null ? null : visibleAssistantText(message.content), tool_calls: calls, tokens: parsed.data.usage?.total_tokens }
}

export async function testProvider(profile: ProviderProfile, apiKey: string, signal?: AbortSignal): Promise<void> {
  const name = "taberrand_check"
  const reply = await completeChat(profile, apiKey, [{
    role: "user", content: "调用工具 taberrand_check，参数为空对象。",
  }], [{
    type: "function",
    function: { name, description: "验证工具调用能力", parameters: { type: "object", properties: {}, additionalProperties: false } },
  }], { signal, namedTool: name })
  if (!reply.tool_calls.some(call => call.function.name === name)) throw new Error("该模型未返回工具调用")
}
