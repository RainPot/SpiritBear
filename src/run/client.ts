import type { PanelCommand, PanelReply, RunState } from "./state"

export class PanelClient {
  private port?: chrome.runtime.Port
  private nextId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private closed = false

  constructor(private onRun: (run: RunState) => void, private onLost: () => void) {}

  private connect(): chrome.runtime.Port {
    if (this.closed) throw new Error("侧栏已关闭")
    if (this.port) return this.port
    const port = chrome.runtime.connect({ name: "taberrand-sidepanel" })
    this.port = port
    port.onMessage.addListener((message: PanelReply) => {
      if ("event" in message) {
        this.onRun(message.run)
        return
      }
      const request = this.pending.get(message.requestId)
      if (!request) return
      this.pending.delete(message.requestId)
      if ("error" in message) request.reject(new Error(message.error))
      else request.resolve(message.value)
    })
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      if (this.port !== port) return
      this.port = undefined
      this.rejectPending()
      if (!this.closed) this.onLost()
    })
    return port
  }

  private rejectPending(): void {
    for (const request of this.pending.values()) request.reject(new Error("后台连接已断开，重新打开侧栏或继续任务"))
    this.pending.clear()
  }

  request<T>(command: PanelCommand): Promise<T> {
    const requestId = ++this.nextId
    return new Promise((resolve, reject) => {
      const port = this.connect()
      this.pending.set(requestId, { resolve: value => resolve(value as T), reject })
      try { port.postMessage({ requestId, command }) } catch (error) {
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  close(): void {
    this.closed = true
    this.port?.disconnect()
    this.port = undefined
    this.rejectPending()
  }
}
