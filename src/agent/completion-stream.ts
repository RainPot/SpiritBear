import { z } from "zod"

const choiceSchema = z.object({
  delta: z.object({
    content: z.string().nullish(),
    tool_calls: z.array(z.object({
      index: z.number().int().min(0).max(19),
      id: z.string().nullish(),
      type: z.literal("function").nullish(),
      function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
    })).max(20).nullish(),
  }).nullish(),
  finish_reason: z.string().nullish(),
})

const chunkSchema = z.object({
  choices: z.array(choiceSchema).max(1),
  usage: z.object({ total_tokens: z.number().optional() }).nullish(),
})

type StreamingTool = { id: string; type: "function"; function: { name: string; arguments: string } }

export function visibleAssistantText(value: string, streaming = false): string {
  const text = value.replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  if (!streaming) return text
  // 标签可能被拆成多个增量，等确认不是推理标记后再显示。
  const start = text.lastIndexOf("<")
  const tail = start >= 0 ? text.slice(start).toLowerCase() : ""
  return tail && !tail.includes(">") &&
    ["<think>", "<analysis>", "<reasoning>"].some(tag => tag.startsWith(tail) || tail.startsWith(tag.slice(0, -1) + " "))
    ? text.slice(0, start) : text
}

export async function readCompletionStream(body: ReadableStream<Uint8Array>, onText?: (text: string) => void): Promise<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, StreamingTool>()
  const separator = /\r?\n\r?\n/
  let buffer = ""
  let content = ""
  let preview = ""
  let tokens: number | undefined
  let finished = false
  let done = false

  function receive(frame: string) {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n")
    if (!data) return
    if (data.trim() === "[DONE]") { done = true; return }
    const chunk = chunkSchema.parse(JSON.parse(data))
    tokens = chunk.usage?.total_tokens ?? tokens
    const choice = chunk.choices[0]
    if (!choice) return
    finished ||= Boolean(choice.finish_reason)
    content += choice.delta?.content ?? ""
    if (content.length > 120_000) throw new Error("模型回复过长")
    for (const delta of choice.delta?.tool_calls ?? []) {
      const call: StreamingTool = calls.get(delta.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } }
      call.id += delta.id ?? ""
      call.function.name += delta.function?.name ?? ""
      call.function.arguments += delta.function?.arguments ?? ""
      if (call.id.length > 200 || call.function.name.length > 80 || call.function.arguments.length > 100_000) {
        throw new Error("模型工具调用过长")
      }
      calls.set(delta.index, call)
    }
  }

  try {
    while (!done) {
      const chunk = await reader.read()
      if (chunk.done) {
        receive(buffer + decoder.decode())
        break
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > 2_200_000) throw new Error("模型数据块过长")
      let boundary = separator.exec(buffer)
      while (boundary && !done) {
        receive(buffer.slice(0, boundary.index))
        buffer = buffer.slice(boundary.index + boundary[0].length)
        boundary = separator.exec(buffer)
      }
      if (onText) {
        const text = calls.size ? "" : visibleAssistantText(content, true).slice(0, 32_000)
        if (text !== preview) {
          preview = text
          onText(text)
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  if (!done && !finished) throw new Error("模型的流式回复中途断开")
  const tool_calls = [...calls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call)
  return { choices: [{ message: { content, tool_calls } }], usage: { total_tokens: tokens } }
}
