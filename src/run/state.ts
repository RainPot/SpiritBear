import type { SearchSnapshot } from "../browser/search-proof"
import type { ProviderId } from "../agent/provider"
import type { Artifact, Criteria, Evidence } from "../agent/report"

export interface PageRef {
  tabId: number
  title: string
  origin: string
}

export const pageActionLabels = { summarize: "总结本页", translate: "翻译本页" } as const
export type PageAction = keyof typeof pageActionLabels

export interface RunPage extends PageRef {
  id: string
  role: "reference" | "task"
  url?: string
  observation?: SearchSnapshot
}

export interface RunEvent {
  id: string
  at: number
  label: string
  detail?: string
  outcome?: "rejected" | "dispatched" | "unknown"
}

export interface DownloadState {
  attempt: string
  owner: string
  state: "pending" | "in_progress" | "complete" | "interrupted" | "unknown"
  id?: number
  filename?: string
}

export interface RunState {
  id: string
  session: string
  conversationId?: string
  references?: string[]
  owner?: string
  windowId: number
  task: string
  provider: ProviderId
  model?: string
  pageAction?: PageAction
  startUrl?: string
  criteria: Criteria
  fixedCount?: number
  query?: string
  searchAttempt?: { pageId: string; query: string; before: SearchSnapshot }
  searchResult?: { url: string; title: string }
  pages: RunPage[]
  activePageId?: string
  allowedOrigins: string[]
  groupId?: number
  focusTabId?: number
  requestedOrigin?: string
  evidence: Evidence[]
  events: RunEvent[]
  tokens: number
  steps: number
  createdAt: number
  updatedAt: number
  status: "running" | "paused" | "needs_user" | "complete" | "partial" | "interrupted"
  reason?: string
  inFlight?: { id: string; label: string; at: number; epoch: string }
  report?: Artifact
  answer?: string
  download?: DownloadState
}

export interface StartInput {
  windowId: number
  task: string
  provider: ProviderId
  model?: string
  references: PageRef[]
  currentPage?: PageRef
  pageAction?: PageAction
  previousRunId?: string
  startUrl?: string
}

export type PanelCommand =
  | { kind: "history" }
  | { kind: "start"; input: StartInput }
  | { kind: "resume"; id: string }
  | { kind: "pause"; id: string; reason: string }
  | { kind: "grant"; id: string; origin: string }
  | { kind: "tool"; id: string; name: string; raw: string }
  | { kind: "model"; id: string; tokens: number; durationMs: number }
  | { kind: "limit"; id: string; reason: string }
  | { kind: "answer"; id: string; text: string }
  | { kind: "export_start"; id: string; automatic: boolean }
  | { kind: "export_record"; id: string; attempt: string; downloadId?: number; uncertain?: boolean }
  | { kind: "focus"; id: string; pageId?: string }
  | { kind: "cleanup"; id: string }
  | { kind: "clear" }
  | { kind: "ping" }

export interface RunHistory {
  session: string
  runs: RunState[]
}

export interface ToolResult {
  run: RunState
  output: unknown
}

export interface MarkdownExport {
  attempt: string
  filename: string
  markdown: string
}

export interface PanelRequest {
  requestId: number
  command: PanelCommand
}

export type PanelReply =
  | { requestId: number; value: unknown }
  | { requestId: number; error: string }
  | { event: "updated"; run: RunState }

export function conversationId(run: RunState): string {
  return run.conversationId ?? run.id
}

export function addEvent(run: RunState, label: string, detail?: string, outcome?: RunEvent["outcome"], id: string = crypto.randomUUID()): void {
  run.events = [...run.events.slice(-79), { id, at: Date.now(), label, detail, outcome }]
}
