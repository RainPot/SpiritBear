import { useState, type FormEvent } from "react"
import { reasoningLevels, type ReasoningEffort } from "../../src/agent/model-options"
import { isBuiltinProvider, modelHostPattern } from "../../src/agent/provider"
import { connectProvider, disconnectProvider, saveReasoningEffort, type ModelChoice, type ModelConnection } from "../../src/agent/settings"
import { uiLanguageKey, type UiLanguage } from "../../src/i18n"
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

const effortLabels: Record<ReasoningEffort, string> = {
  none: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高",
}

const optionKey = (provider: ModelChoice["provider"], model: string) => JSON.stringify([provider, model])

export function ModelParameters({ connections, selected, onChanged }: {
  connections: ModelConnection[]
  selected?: ModelChoice
  onChanged: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [choice, setChoice] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState("")
  const options = connections.flatMap(connection => connection.profile.models.map(model => ({
    connection, model, key: optionKey(connection.profile.id, model),
  })))
  const preferred = selected ? optionKey(selected.provider, selected.model) : undefined
  const option = options.find(item => item.key === (choice || preferred)) ??
    options.find(item => reasoningLevels(item.connection.profile.id, item.model).length) ?? options[0]
  if (!option) return null

  const { connection, model } = option
  const provider = connection.profile.id
  const levels = reasoningLevels(provider, model)
  const deepseek = provider === "deepseek"
  const saved = connection.reasoning
  const effort = saved && Object.hasOwn(saved, model) ? saved[model] : undefined

  async function save(value: string) {
    setBusy(true)
    setFeedback("")
    try {
      await saveReasoningEffort(provider, model, value ? value as ReasoningEffort : undefined)
      await onChanged()
      setFeedback("模型参数已保存")
    } catch {
      setFeedback("模型参数保存失败")
    } finally {
      setBusy(false)
    }
  }

  return <section className="settings" aria-labelledby="model-parameters-heading">
    <div className="section-heading">
      <h2 id="model-parameters-heading">{t("模型参数")}</h2>
    </div>
    <div className="field">
      <label htmlFor="model-parameters-model">{t("选择要配置的模型")}</label>
      <select id="model-parameters-model" value={option.key} disabled={busy} onChange={event => { setChoice(event.target.value); setFeedback("") }}>
        {connections.map(({ profile }) => <optgroup key={profile.id} label={profile.label}>
          {profile.models.map(id => <option key={id} value={optionKey(profile.id, id)}>{id}</option>)}
        </optgroup>)}
      </select>
    </div>
    {levels.length > 0 ? <div className="field">
      <label htmlFor="model-parameters-effort">{t("思考强度")}</label>
      <select id="model-parameters-effort" value={deepseek && effort === "none" ? "" : effort ?? ""} disabled={busy}
        onChange={event => void save(event.target.value)}>
        <option value="">{t(deepseek ? "关闭（默认）" : "模型默认")}</option>
        {levels.filter(level => !deepseek || level !== "none").map(level =>
          <option key={level} value={level}>{t(effortLabels[level])}</option>)}
      </select>
    </div> : <p className="hint">{t("此模型未提供可调节的思考强度。")}</p>}
    {!isBuiltinProvider(provider) && <p className="hint">{t("自定义端点需支持 reasoning_effort。")}</p>}
    {feedback && <p className="notice" role="status">{t(feedback)}</p>}
  </section>
}

interface ConnectionFormProps {
  connection: ModelConnection
  onBack: () => void
  onChanged: () => Promise<void>
}

function ConnectionForm({ connection, onBack, onChanged }: ConnectionFormProps) {
  const { t } = useLanguage()
  const { profile, connected } = connection
  const custom = !isBuiltinProvider(profile.id)
  const [label, setLabel] = useState(profile.label)
  const [baseUrl, setBaseUrl] = useState(profile.baseUrl)
  const [models, setModels] = useState(profile.models.join("\n"))
  const [key, setKey] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function apply(action: () => Promise<void>, pending: string) {
    setBusy(true)
    setError("")
    setStatus(pending)
    try {
      await action()
      await onChanged()
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
    const ids = [...new Set(models.split("\n").map(value => value.trim()).filter(Boolean))]
    if (!ids.length) {
      setError("请填写至少一个模型 ID")
      return
    }
    try {
      const candidate = { id: profile.id, label: label.trim(), baseUrl: baseUrl.trim(), models: ids }
      const authorized = chrome.permissions.request({ origins: [modelHostPattern(candidate.baseUrl)] })
      void apply(() => connectProvider(candidate, key, authorized), "正在测试模型工具调用…")
    } catch (error) {
      setError(error instanceof Error ? error.message : "模型配置无效")
    }
  }

  return <form onSubmit={submit}>
    <div className="section-heading">
      <h1>{profile.label ? t(connected ? "管理 {name}" : "连接 {name}", { name: profile.label }) : t("添加自定义端点")}</h1>
      {custom && <p>{t("连接 OpenAI 兼容 API，支持 HTTPS 和本机 HTTP 地址。")}</p>}
    </div>
    {custom && <label className="field">{t("名称")}
      <input value={label} onChange={event => setLabel(event.target.value)} placeholder={t("例如 本地模型")}
        maxLength={60} required disabled={busy} />
    </label>}
    <label className="field">API Base URL
      <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)}
        placeholder={custom ? "http://localhost:11434/v1" : undefined} required disabled={busy} />
    </label>
    <label className="field">API Key
      <input type="password" value={key} onChange={event => setKey(event.target.value)}
        autoComplete="off" spellCheck={false} disabled={busy} required={!custom && !connected}
        placeholder={t(connected ? "留空沿用此地址的密钥" : custom ? "可选" : "输入 API Key")} />
    </label>
    <label className="field">{t("模型 ID")}
      <textarea value={models} onChange={event => setModels(event.target.value)}
        rows={3} maxLength={3000} placeholder={t("每行一个模型 ID")} required disabled={busy} />
    </label>
    <p className="hint">{t("连接时用第一个模型测试工具调用。浏览器重启后需重新连接。")}</p>
    <div className="actions">
      <button className="primary" disabled={busy}>{t(connected ? "保存并测试" : "连接并测试")}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onBack}>{t("返回连接列表")}</button>
      {connected && <button type="button" className="plain" disabled={busy}
        onClick={() => void apply(() => disconnectProvider(profile.id), "正在断开…")}>{t("断开连接")}</button>}
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
          <div className="connection-name">
            <strong>{item.profile.label}</strong>
            <small>{item.connected ? t("已连接 · {count} 个模型", { count: item.profile.models.length }) : t("未连接")}</small>
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
