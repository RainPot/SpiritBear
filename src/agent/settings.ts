import { hostPattern } from "../browser/urls"
import { completionEndpoint, providers, type ProviderId, type ProviderProfile } from "./provider"

export async function readProvider(id: ProviderId): Promise<{ profile: ProviderProfile; apiKey?: string }> {
  const name = "provider-" + id
  const [configuration, session] = await Promise.all([chrome.storage.local.get(name), chrome.storage.session.get(name)])
  const saved = configuration[name] as Partial<ProviderProfile> | undefined
  const credential = session[name] as { key: string; endpoint: string } | undefined
  const profile: ProviderProfile = {
    id,
    model: typeof saved?.model === "string" ? saved.model : providers[id].model,
    baseUrl: typeof saved?.baseUrl === "string" ? saved.baseUrl : providers[id].baseUrl,
  }
  const apiKey = credential?.endpoint === completionEndpoint(profile.baseUrl).href ? credential.key : undefined
  return { profile, apiKey }
}

export async function writeProvider(profile: ProviderProfile, key: string, authorized: Promise<boolean>): Promise<void> {
  if (!await authorized) throw new Error("Chrome 未授权访问模型 API")
  const endpoint = completionEndpoint(profile.baseUrl).href
  const name = "provider-" + profile.id
  const previous = (await chrome.storage.session.get(name))[name] as { key: string; endpoint: string } | undefined
  if (!key && (!previous || previous.endpoint !== endpoint)) throw new Error("请为这个 API 地址输入 API Key")
  if (key) await chrome.storage.session.set({ [name]: { key, endpoint } })
  await chrome.storage.local.set({ [name]: profile, selectedProvider: profile.id })
}

export async function providerForRun(id: ProviderId): Promise<{ profile: ProviderProfile; apiKey: string }> {
  const { profile, apiKey } = await readProvider(id)
  if (!apiKey) throw new Error("请在模型设置填入 " + (id === "openai" ? "OpenAI" : "DeepSeek") + " 的 API Key")
  const origin = completionEndpoint(profile.baseUrl).origin
  if (!await chrome.permissions.contains({ origins: [hostPattern(origin)] })) throw new Error("请在模型设置重新授权 API 地址")
  return { profile, apiKey }
}
