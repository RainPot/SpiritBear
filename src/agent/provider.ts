import { z } from "zod"
import { httpsUrl } from "../browser/urls"
import type { ToolDefinition } from "./contracts"

export type ProviderId = "openai" | "deepseek"

export interface ProviderProfile {
  id: ProviderId
  baseUrl: string
  model: string
}

export const providers: Record<ProviderId, ProviderProfile> = {
  openai: { id: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  deepseek: { id: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
}

export const providerLabels = { openai: "OpenAI", deepseek: "DeepSeek" }

export function completionEndpoint(baseUrl: string): URL {
  const endpoint = httpsUrl(baseUrl.trim())
  if (endpoint.search || endpoint.hash) throw new Error("API Base URL 请使用不含查询或片段的地址")
  const path = endpoint.pathname.replace(/\/+$/, "")
  endpoint.pathname = path.endsWith("/chat/completions") ? path : path + "/chat/completions"
  return endpoint
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

export type ChatMessage =
  | { role: "system" | "user"; content: string }
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

export async function completeChat(
  profile: ProviderProfile,
  apiKey: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  namedTool?: string,
): Promise<Completion> {
  const endpoint = completionEndpoint(profile.baseUrl)
  const deadline = AbortSignal.timeout(55_000)
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  let response: Response
  try {
    response = await fetcher(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: requestSignal,
      body: JSON.stringify({
        model: profile.model,
        messages,
        tools,
        stream: false,
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
    throw new Error("模型 API 返回 HTTP " + response.status + "，请检查模型 ID 与工具调用支持")
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(deadline.aborted ? "读取模型响应超时" : "模型 API 响应不是有效 JSON")
  }
  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) throw new Error("模型响应不符合 Chat Completions 工具协议")
  const message = parsed.data.choices[0].message
  const calls = message.tool_calls ?? []
  if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("模型返回了重复的工具调用 ID")
  return { content: message.content ?? null, tool_calls: calls, tokens: parsed.data.usage?.total_tokens }
}

export async function testProvider(profile: ProviderProfile, apiKey: string, signal?: AbortSignal): Promise<void> {
  const name = "taberrand_check"
  const reply = await completeChat(profile, apiKey, [{
    role: "user", content: "调用工具 taberrand_check，参数为空对象。",
  }], [{
    type: "function",
    function: { name, description: "验证工具调用能力", parameters: { type: "object", properties: {}, additionalProperties: false } },
  }], signal, fetch, name)
  if (!reply.tool_calls.some(call => call.function.name === name)) throw new Error("该模型未返回工具调用")
}
