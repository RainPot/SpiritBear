import { useEffect, useState } from "react"
import { completionEndpoint, providerLabels, providers, testProvider, type ProviderId } from "../../src/agent/provider"
import { readProvider, writeProvider } from "../../src/agent/settings"
import { hostPattern } from "../../src/browser/urls"

export function Settings({ provider, onProvider }: { provider: ProviderId; onProvider: (value: ProviderId) => void }) {
  const [baseUrl, setBaseUrl] = useState(providers[provider].baseUrl)
  const [model, setModel] = useState(providers[provider].model)
  const [key, setKey] = useState("")
  const [stored, setStored] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setKey("")
    setStored(false)
    setStatus("")
    setError(false)
    setBaseUrl(providers[provider].baseUrl)
    setModel(providers[provider].model)
    void readProvider(provider).then(({ profile, apiKey }) => {
      if (!active) return
      setBaseUrl(profile.baseUrl)
      setModel(profile.model)
      setStored(Boolean(apiKey))
    }, () => { if (active) setStatus("读取配置失败") })
    return () => { active = false }
  }, [provider])

  function apply(verify: boolean) {
    setError(false)
    setStatus("")
    if (busy) return
    try {
      const profile = { id: provider, model: model.trim(), baseUrl: baseUrl.trim() }
      if (!profile.model) throw new Error("请输入模型 ID")
      const origin = completionEndpoint(profile.baseUrl).origin
      const authorized = chrome.permissions.request({ origins: [hostPattern(origin)] })
      setBusy(true)
      setStatus("等待 Chrome 授权…")
      void (async () => {
        try {
          await writeProvider(profile, key.trim(), authorized)
          setKey("")
          setStored(true)
          if (verify) {
            setStatus("正在测试工具调用…")
            const saved = await readProvider(provider)
            if (!saved.apiKey) throw new Error("请先输入 API Key")
            await testProvider(saved.profile, saved.apiKey)
          }
          setStatus(verify ? "工具调用测试通过" : "模型配置已保存")
        } catch (error) {
          setError(true)
          setStatus(error instanceof Error ? error.message : "保存模型失败")
        } finally {
          setBusy(false)
        }
      })()
    } catch (error) {
      setError(true)
      setStatus(error instanceof Error ? error.message : "模型配置无效")
    }
  }

  return <section className="card settings">
    <div className="section-heading">
      <div><h1>模型设置</h1><p>用你自己的 API Key 调用模型。</p></div>
    </div>
    <div className="segmented" aria-label="模型供应商">
      {(["openai", "deepseek"] as const).map(id => <button type="button" key={id} disabled={busy}
        aria-pressed={id === provider} onClick={() => onProvider(id)}>{providerLabels[id]}</button>)}
    </div>
    <label className="field">API Base URL
      <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} disabled={busy} />
    </label>
    <label className="field">模型 ID
      <input value={model} maxLength={160} onChange={event => setModel(event.target.value)} disabled={busy} />
    </label>
    <label className="field">API Key
      <input type="password" value={key} onChange={event => setKey(event.target.value)}
        autoComplete="off" spellCheck={false} disabled={busy}
        placeholder={stored ? "已保存到当前浏览器会话" : "粘贴 API Key"} />
    </label>
    <p className="hint">Chrome 重启后需要重新输入 Key。对话和任务所需的网页片段会发送给所选模型。测试连接会调用一次模型工具。</p>
    <div className="actions">
      <button className="primary" disabled={busy || (!key.trim() && !stored)} onClick={() => apply(false)}>保存并授权</button>
      <button className="secondary" disabled={busy || (!key.trim() && !stored)} onClick={() => apply(true)}>测试连接</button>
    </div>
    {status && <p role={error ? "alert" : "status"} className={error ? "notice warning" : "notice"}>{status}</p>}
  </section>
}
