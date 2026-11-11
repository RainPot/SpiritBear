import { useEffect, useState, type FormEvent } from "react"
import { readSiteGuides, removeSiteGuide, saveSiteGuide, siteGuideLimit } from "../../src/agent/site-guides"

export function SiteGuides() {
  const [guides, setGuides] = useState<Awaited<ReturnType<typeof readSiteGuides>>>([])
  const [site, setSite] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean }>()

  useEffect(() => {
    let active = true
    void readSiteGuides().then(items => {
      if (active) setGuides(items)
    }, () => {
      if (active) setStatus({ text: "读取站点指引失败", error: true })
    })
    return () => { active = false }
  }, [])

  async function change(action: () => Promise<void>, feedback: string) {
    if (busy) return
    setBusy(true)
    setStatus(undefined)
    try {
      await action()
      setGuides(await readSiteGuides())
      setStatus({ text: feedback })
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : "更新站点指引失败", error: true })
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void change(async () => { setSite(await saveSiteGuide(site, note)) }, "指引已保存")
  }

  return <section className="settings site-guides" aria-labelledby="site-guides-heading">
    <div className="section-heading">
      <h2 id="site-guides-heading">站点指引</h2>
      <p>记下某个站点的搜索入口或筛选步骤。该站点加入任务后，指引会随任务发送给模型。</p>
    </div>
    {!!guides.length && <ul className="site-guide-list" aria-label="已保存的站点指引">
      {guides.map(guide => {
        const host = new URL(guide.origin).host
        return <li key={guide.origin}>
          <button type="button" className="plain" disabled={busy} title={guide.origin}
            aria-pressed={site === guide.origin} onClick={() => {
              setSite(guide.origin)
              setNote(guide.note)
              setStatus(undefined)
            }}>{host}</button>
          <button type="button" className="plain small" disabled={busy} aria-label={"删除 " + host}
            onClick={() => void change(async () => {
              await removeSiteGuide(guide.origin)
              if (site === guide.origin) {
                setSite("")
                setNote("")
              }
            }, "指引已删除")}>删除</button>
        </li>
      })}
    </ul>}
    <form onSubmit={submit}>
      <label className="field">站点网址
        <input value={site} onChange={event => setSite(event.target.value)} placeholder="例如 www.xiaohongshu.com"
          autoCapitalize="off" spellCheck={false} maxLength={2048} disabled={busy} />
      </label>
      <label className="field">操作指引
        <textarea value={note} onChange={event => setNote(event.target.value)} rows={3}
          placeholder="例如先用首页的搜索框，再按最新排序" maxLength={siteGuideLimit} disabled={busy} />
      </label>
      <div className="actions">
        <button className="primary" disabled={busy || !site.trim() || !note.trim()}>保存指引</button>
      </div>
    </form>
    {status && <p role={status.error ? "alert" : "status"} className={status.error ? "notice warning" : "notice"}>
      {status.text}
    </p>}
  </section>
}
