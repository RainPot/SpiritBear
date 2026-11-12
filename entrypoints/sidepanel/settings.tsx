import { useEffect, useRef, useState, type FormEvent } from "react"
import { completionEndpoint, isBuiltinProvider, modelHostPattern, type ProviderId } from "../../src/agent/provider"
import { connectProvider, disconnectProvider, loadModelCatalog, preferredModels, type ModelConnection } from "../../src/agent/settings"
import { uiLanguageKey, type UiLanguage } from "../../src/i18n"
import { ChatIcon } from "./chat-icon"
import { useLanguage } from "./language"

export function LanguageSetting() {
  const { language, t } = useLanguage()
  const [error, setError] = useState(false)

  async function choose(value: UiLanguage) {
    setError(false)
    try {
      await chrome.storage.local.set({ [uiLanguageKey]: value })
    } catch {
      setError(true)
    }
  }

  return <section className="settings" aria-labelledby="language-heading">
    <div className="language-setting">
      <h2 id="language-heading">{t("界面语言")}</h2>
      <div className="segmented" role="group" aria-labelledby="language-heading">
        <button type="button" lang="zh-CN" aria-pressed={language === "zh-CN"}
          onClick={() => void choose("zh-CN")}>简体中文</button>
        <button type="button" lang="en" aria-pressed={language === "en"}
          onClick={() => void choose("en")}>English</button>
      </div>
    </div>
    {error && <p className="notice warning" role="alert">{t("语言设置保存失败，请重试")}</p>}
  </section>
}

function ProviderLogo({ id }: { id: ProviderId }) {
  return isBuiltinProvider(id)
    ? <img className="provider-logo" src={"/provider/" + id + ".png"} alt="" width={22} height={22} />
    : <span className="provider-logo custom-provider" aria-hidden="true"><ChatIcon name="link" size={17} /></span>
}

interface ConnectionFormProps {
  connection: ModelConnection
  onBack: () => void
  onChanged: () => Promise<void>
}

function sameEndpoint(first: string, second: string): boolean {
  try {
    return completionEndpoint(first).href === completionEndpoint(second).href
  } catch {
    return false
  }
}

function ConnectionForm({ connection, onBack, onChanged }: ConnectionFormProps) {
  const { t } = useLanguage()
  const { profile, connected } = connection
  const custom = !isBuiltinProvider(profile.id)
  const [label, setLabel] = useState(profile.label)
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl)
  const [model, setModel] = useState(profile.models[0] ?? "")
  const [catalog, setCatalog] = useState<string[]>([])
  const [key, setKey] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const catalogRequest = useRef<AbortController>(null)
  const useSavedKey = connected && !key.trim() && sameEndpoint(baseUrl, profile.baseUrl)
  const choices = catalog.length ? catalog : useSavedKey ? profile.models : []

  function resetCatalog() {
    catalogRequest.current?.abort()
    setCatalog([])
    setLoading(false)
    setError("")
  }

  useEffect(() => {
    if (!baseUrl.trim() || (!custom && !key.trim() && !useSavedKey)) return
    const request = new AbortController()
    catalogRequest.current = request
    const timer = window.setTimeout(async () => {
      try {
        const origins = [modelHostPattern(baseUrl)]
        const allowed = await chrome.permissions.contains({ origins })
        if (!allowed || request.signal.aborted) return
        setLoading(true)
        const available = await loadModelCatalog({ id: profile.id, baseUrl }, key, Promise.resolve(true), request.signal)
        if (!request.signal.aborted) {
          setCatalog(available)
          setError("")
        }
      } catch (error) {
        if (!request.signal.aborted && !(error instanceof TypeError)) {
          setError(error instanceof Error ? error.message : "模型配置更新失败")
        }
      } finally {
        if (!request.signal.aborted) setLoading(false)
      }
    }, 450)
    return () => {
      request.abort()
      window.clearTimeout(timer)
    }
  }, [baseUrl, custom, key, profile.id, useSavedKey])

  async function apply(action: () => Promise<void>, pending: string) {
    setBusy(true)
    setError("")
    setStatus(pending)
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : "模型配置更新失败")
    } finally {
      setBusy(false)
      setStatus("")
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    try {
      const candidate = { id: profile.id, label: label.trim(), baseUrl: baseUrl.trim() }
      const authorized = chrome.permissions.request({ origins: [modelHostPattern(candidate.baseUrl)] })
      catalogRequest.current?.abort()
      setLoading(false)
      void apply(async () => {
        const available = catalog.length ? catalog : await loadModelCatalog(candidate, key, authorized).catch(error => {
          if (useSavedKey) return profile.models
          throw error
        })
        setCatalog(available)
        setStatus("正在测试模型工具调用…")
        await connectProvider({ ...candidate, models: preferredModels(available, model) }, key, authorized)
        await onChanged()
      }, "正在加载模型列表…")
    } catch (error) {
      setError(error instanceof TypeError ? "请输入有效的 API Base URL" :
        error instanceof Error ? error.message : "模型配置无效")
    }
  }

  return <form onSubmit={submit}>
    <div className="section-heading">
      <h1 className="provider-heading"><ProviderLogo id={profile.id} />
        {profile.label ? t(connected ? "管理 {name}" : "连接 {name}", { name: profile.label }) : t("添加自定义端点")}
      </h1>
      {custom && <p>{t("连接 OpenAI 兼容 API，支持 HTTPS 和本机 HTTP 地址。")}</p>}
    </div>
    {custom && <label className="field">{t("名称")}
      <input value={label} onChange={event => setLabel(event.target.value)} placeholder={t("例如 本地模型")}
        maxLength={60} required disabled={busy} />
    </label>}
    <label className="field">API Base URL
      <input type="url" value={baseUrl} onChange={event => {
        const address = event.target.value
        if (key && !sameEndpoint(address, baseUrl)) setKey("")
        setBaseUrl(address)
        resetCatalog()
      }}
        placeholder={custom ? "http://localhost:11434/v1" : undefined} required disabled={busy} />
    </label>
    <label className="field">API Key
      <input type="password" value={key} onChange={event => {
        setKey(event.target.value)
        resetCatalog()
      }}
        autoComplete="off" spellCheck={false} disabled={busy} required={!custom && !useSavedKey}
        placeholder={t(connected ? "留空沿用此地址的密钥" : custom ? "可选" : "输入 API Key")} />
    </label>
    <div className="field">
      <label htmlFor="connection-model">{t("默认模型")}</label>
      <select id="connection-model" disabled={busy || loading || !choices.length}
        value={choices.includes(model) ? model : choices[0] ?? ""} onChange={event => setModel(event.target.value)}>
        {!choices.length && <option value="">{t(loading || status === "正在加载模型列表…" ? "正在加载模型列表…" : "连接后自动加载模型")}</option>}
        {choices.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
    </div>
    <div className="actions">
      <button className="primary" disabled={busy}>{t(connected ? "保存并测试" : "连接并测试")}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onBack}>{t("返回连接列表")}</button>
      {connected && <button type="button" className="plain" disabled={busy}
        onClick={() => void apply(async () => {
          await disconnectProvider(profile.id)
          await onChanged()
        }, "正在断开…")}>{t("断开连接")}</button>}
    </div>
    {error && <p role="alert" className="notice warning">{t(error)}</p>}
    {status && <p role="status" className="notice">{t(status)}</p>}
  </form>
}

export function Settings({ connections, onChanged }: { connections: ModelConnection[]; onChanged: () => Promise<void> }) {
  const { t } = useLanguage()
  const [editing, setEditing] = useState<ModelConnection>()
  const [feedback, setFeedback] = useState(false)

  function edit(connection: ModelConnection) {
    setFeedback(false)
    setEditing(connection)
  }

  return <section className="settings">
    {editing ? <ConnectionForm key={editing.profile.id} connection={editing} onBack={() => setEditing(undefined)}
      onChanged={async () => {
        await onChanged()
        setEditing(undefined)
        setFeedback(true)
      }} /> : <>
      <div className="section-heading">
        <h1>{t("模型连接")}</h1>
        <p>{t("连接供应商后，在对话输入框选择模型。")}</p>
      </div>
      <ul className="connection-list" aria-label={t("模型供应商")}>
        {connections.map(item => <li key={item.profile.id}>
          <div className="connection-identity">
            <ProviderLogo id={item.profile.id} />
            <div className="connection-name">
              <strong>{item.profile.label}</strong>
              <small>{item.connected ? t("已连接 · {count} 个模型", { count: item.profile.models.length }) : t("未连接")}</small>
            </div>
          </div>
          <button type="button" className="secondary" onClick={() => edit(item)}
            aria-label={t(item.connected ? "管理 {name}" : "连接 {name}", { name: item.profile.label })}>
            {t(item.connected ? "管理" : "连接")}
          </button>
        </li>)}
      </ul>
      <button type="button" className="plain add-endpoint" onClick={() => edit({
        connected: false, profile: { id: `custom:${crypto.randomUUID()}`, label: "", baseUrl: "", models: [] },
      })}>{t("添加自定义端点")}</button>
      {feedback && <p className="notice" role="status">{t("模型连接已更新")}</p>}
    </>}
  </section>
}
