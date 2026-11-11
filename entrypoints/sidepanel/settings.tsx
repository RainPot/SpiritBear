import { useState, type FormEvent } from "react"
import { isBuiltinProvider, modelHostPattern } from "../../src/agent/provider"
import { connectProvider, disconnectProvider, type ModelConnection } from "../../src/agent/settings"

interface ConnectionFormProps {
  connection: ModelConnection
  onBack: () => void
  onChanged: () => Promise<void>
}

function ConnectionForm({ connection, onBack, onChanged }: ConnectionFormProps) {
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
      <h1>{profile.label ? (connected ? "管理 " : "连接 ") + profile.label : "添加自定义端点"}</h1>
      {custom && <p>连接 OpenAI 兼容 API，支持 HTTPS 和本机 HTTP 地址。</p>}
    </div>
    {custom && <label className="field">名称
      <input value={label} onChange={event => setLabel(event.target.value)} placeholder="例如 本地模型"
        maxLength={60} required disabled={busy} />
    </label>}
    <label className="field">API Base URL
      <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)}
        placeholder={custom ? "http://localhost:11434/v1" : undefined} required disabled={busy} />
    </label>
    <label className="field">API Key
      <input type="password" value={key} onChange={event => setKey(event.target.value)}
        autoComplete="off" spellCheck={false} disabled={busy} required={!custom && !connected}
        placeholder={connected ? "留空沿用此地址的密钥" : custom ? "可选" : "输入 API Key"} />
    </label>
    <label className="field">模型 ID
      <textarea value={models} onChange={event => setModels(event.target.value)}
        rows={3} maxLength={3000} placeholder="每行一个模型 ID" required disabled={busy} />
    </label>
    <p className="hint">连接时用第一个模型测试工具调用。浏览器重启后需重新连接。</p>
    <div className="actions">
      <button className="primary" disabled={busy}>{connected ? "保存并测试" : "连接并测试"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onBack}>返回连接列表</button>
      {connected && <button type="button" className="plain" disabled={busy}
        onClick={() => void apply(() => disconnectProvider(profile.id), "正在断开…")}>断开连接</button>}
    </div>
    {error && <p role="alert" className="notice warning">{error}</p>}
    {status && <p role="status" className="notice">{status}</p>}
  </form>
}

export function Settings({ connections, onChanged }: { connections: ModelConnection[]; onChanged: () => Promise<void> }) {
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
        <h1>模型连接</h1>
        <p>连接供应商后，在对话输入框选择模型。</p>
      </div>
      <ul className="connection-list" aria-label="模型供应商">
        {connections.map(item => <li key={item.profile.id}>
          <div className="connection-name">
            <strong>{item.profile.label}</strong>
            <small>{item.connected ? "已连接 · " + item.profile.models.length + " 个模型" : "未连接"}</small>
          </div>
          <button type="button" className="secondary" onClick={() => edit(item)}
            aria-label={(item.connected ? "管理 " : "连接 ") + item.profile.label}>
            {item.connected ? "管理" : "连接"}
          </button>
        </li>)}
      </ul>
      <button type="button" className="plain add-endpoint" onClick={() => edit({
        connected: false, profile: { id: `custom:${crypto.randomUUID()}`, label: "", baseUrl: "", models: [] },
      })}>添加自定义端点</button>
      {feedback && <p className="notice" role="status">模型连接已更新</p>}
    </>}
  </section>
}
