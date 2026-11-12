import type { ProviderId } from "./provider"

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

const commonEfforts = ["low", "medium", "high"] as const
const deepSeekEfforts = ["none", "low", "high", "max"] as const
const openAiEfforts: Readonly<Record<string, readonly ReasoningEffort[]>> = {
  "gpt-5": ["minimal", ...commonEfforts],
  "gpt-5-mini": ["minimal", ...commonEfforts],
  "gpt-5-nano": ["minimal", ...commonEfforts],
  "gpt-5.1": ["none", ...commonEfforts],
  "gpt-5.2": ["none", ...commonEfforts, "xhigh"],
  "gpt-5.4": ["none", ...commonEfforts, "xhigh"],
  "gpt-5.5": ["none", ...commonEfforts, "xhigh"],
  o1: commonEfforts,
  o3: commonEfforts,
  "o3-mini": commonEfforts,
  "o4-mini": commonEfforts,
}

export function reasoningLevels(provider: ProviderId, model: string): readonly ReasoningEffort[] {
  const id = model.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, "")
  if (provider === "deepseek") return /^deepseek-(?:flash|v4-pro|v4-flash(?:-vision-exp)?)$/.test(id) ? deepSeekEfforts : []
  if (provider === "openai") return Object.hasOwn(openAiEfforts, id) ? openAiEfforts[id] ?? [] : []
  return commonEfforts
}

export function modelReasoningEffort(provider: ProviderId, model: string, value: unknown): ReasoningEffort | undefined {
  if (typeof value === "string" && reasoningLevels(provider, model).includes(value as ReasoningEffort)) {
    return value as ReasoningEffort
  }
}
