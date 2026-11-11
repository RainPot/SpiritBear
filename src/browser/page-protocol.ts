export interface Observation {
  observationId: string
  title: string
  url: string
  text: string
  links: { elementId: string; label: string }[]
  controls: { elementId: string; label: string; kind: "search" | "click" | "choose"; options?: { label: string; value: string }[] }[]
  blocked?: "login" | "challenge"
  searchRequiresLogin?: boolean
}

export type PageCommand = {
  channel: "taberrand-page"
  origin: string
} & (
  | { kind: "observe" }
  | { kind: "link"; observationId: string; elementId: string }
  | { kind: "capture"; observationId: string }
  | {
    kind: "interact"
    observationId: string
    action: "search" | "click" | "choose" | "scroll"
    elementId?: string
    value?: string
    direction?: "up" | "down"
  }
)

export type PageReply =
  | { ok: false; reason: string }
  | { ok: true; observation: Observation }
  | { ok: true; url: string }
  | { ok: true; source: Pick<Observation, "title" | "url" | "text" | "blocked"> }
  | { ok: true; dispatched: true }
