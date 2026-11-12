import { modelReasoningEffort, type ReasoningEffort } from "./model-options"
import { completionEndpoint, isBuiltinProvider, isProviderId, modelHostPattern, providerLabels, providers, testProvider, type ProviderId } from "./provider"

export interface ConnectionProfile {
  id: ProviderId
  label: string
  baseUrl: string
  models: string[]
}

export interface ModelConnection {
  profile: ConnectionProfile
  connected: boolean
  reasoning?: Record<string, ReasoningEffort>
}

export interface ModelChoice {
  provider: ProviderId
  model: string
}

const providerKey = "provider-"
const effortKey = (id: ProviderId, model: string) => "model-reasoning-" + JSON.stringify([id, model])

function connectionProfile(id: ProviderId, raw: unknown): ConnectionProfile | undefined {
  const saved = raw as (Partial<ConnectionProfile> & { model?: string }) | undefined
  const preset = isBuiltinProvider(id) ? providers[id] : undefined
  const baseUrl = saved?.baseUrl ?? preset?.baseUrl
  const label = isBuiltinProvider(id) ? providerLabels[id] : saved?.label
  const models = (Array.isArray(saved?.models) ? saved.models : [saved?.model ?? preset?.model])
    .filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
  if (typeof baseUrl !== "string" || typeof label !== "string" || !models.length) return
  return { id, label, baseUrl, models }
}

function keyFor(profile: ConnectionProfile, raw: unknown): string | undefined {
  const saved = raw as { key?: string; endpoint?: string } | undefined
  try {
    if (typeof saved?.key === "string" && saved.endpoint === completionEndpoint(profile.baseUrl).href) return saved.key
  } catch { /* 保留配置供用户修正地址。 */ }
}

export async function readModelSettings(): Promise<{ connections: ModelConnection[]; selected?: ModelChoice }> {
  const local = await chrome.storage.local.get(null)
  const ids: ProviderId[] = ["openai", "deepseek"]
  for (const key of Object.keys(local)) {
    const id = key.slice(providerKey.length)
    if (key.startsWith(providerKey) && isProviderId(id) && !isBuiltinProvider(id)) ids.push(id)
  }
  const session = await chrome.storage.session.get(ids.map(id => providerKey + id))
  const connections = ids.flatMap(id => {
    const name = providerKey + id
    const profile = connectionProfile(id, local[name])
    if (!profile) return []
    const reasoning = Object.fromEntries(profile.models.flatMap(model => {
      const effort = modelReasoningEffort(id, model, local[effortKey(id, model)])
      return effort ? [[model, effort]] : []
    }))
    return [{ profile, connected: keyFor(profile, session[name]) !== undefined, reasoning }]
  })
  const choices = connections.filter(item => item.connected).flatMap(({ profile }) =>
    profile.models.map(model => ({ provider: profile.id, model })))
  const saved = local.selectedModel as Partial<ModelChoice> | undefined
  const selected = choices.find(choice => choice.provider === saved?.provider && choice.model === saved?.model) ??
    choices.find(choice => choice.provider === (saved?.provider ?? local.selectedProvider)) ?? choices[0]
  return { connections, selected }
}

export async function saveReasoningEffort(id: ProviderId, model: string, effort?: ReasoningEffort): Promise<void> {
  const key = effortKey(id, model)
  if (effort === undefined) return chrome.storage.local.remove(key)
  if (!modelReasoningEffort(id, model, effort)) throw new Error("所选模型不支持该思考强度")
  await chrome.storage.local.set({ [key]: effort })
}

export async function connectProvider(profile: ConnectionProfile, key: string, authorized: Promise<boolean>): Promise<void> {
  if (!await authorized) throw new Error("Chrome 未授权访问模型 API")
  const endpoint = completionEndpoint(profile.baseUrl).href
  const name = providerKey + profile.id
  const model = profile.models[0]
  if (!profile.label.trim() || !model || profile.models.some(value => value.length > 160)) {
    throw new Error("请输入连接名称和有效的模型 ID")
  }
  const old = (await chrome.storage.session.get(name))[name]
  const apiKey = key.trim() || keyFor(profile, old) || ""
  if (!apiKey && isBuiltinProvider(profile.id)) throw new Error("请为这个 API 地址输入 API Key")
  await testProvider({ id: profile.id, baseUrl: profile.baseUrl, model }, apiKey)
  await chrome.storage.local.set({ [name]: profile })
  await chrome.storage.session.set({ [name]: { key: apiKey, endpoint } })
}

export function disconnectProvider(id: ProviderId): Promise<void> {
  return chrome.storage.session.remove(providerKey + id)
}

export async function providerForRun(id: ProviderId, model?: string) {
  const name = providerKey + id
  const [local, session] = await Promise.all([chrome.storage.local.get(name), chrome.storage.session.get(name)])
  const connection = connectionProfile(id, local[name])
  const apiKey = connection && keyFor(connection, session[name])
  const selected = model ?? connection?.models[0]
  if (!connection || !selected || apiKey === undefined) throw new Error("请在设置中连接模型")
  if (!await chrome.permissions.contains({ origins: [modelHostPattern(connection.baseUrl)] })) {
    throw new Error("请在设置中重新连接模型并授权 API 地址")
  }
  const key = effortKey(id, selected)
  const reasoningEffort = modelReasoningEffort(id, selected, (await chrome.storage.local.get(key))[key])
  return { profile: { id, baseUrl: connection.baseUrl, model: selected, reasoningEffort }, apiKey }
}
