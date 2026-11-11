import { openDB, type DBSchema } from "idb"
import type { RunState } from "./state"

interface RunDatabase extends DBSchema {
  runs: {
    key: string
    value: RunState
  }
}

let database: ReturnType<typeof openDB<RunDatabase>> | undefined

function db() {
  return database ??= openDB<RunDatabase>("taberrand", 1, {
    upgrade(connection) {
      connection.createObjectStore("runs", { keyPath: "id" })
    },
  })
}

export async function listRuns(): Promise<RunState[]> {
  const runs = await (await db()).getAll("runs")
  return runs.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRun(id: string): Promise<RunState> {
  const run = await (await db()).get("runs", id)
  if (!run) throw new Error("这条任务记录已清除")
  return run
}

export async function createRun(run: RunState): Promise<RunState> {
  const tx = (await db()).transaction("runs", "readwrite")
  const runs = await tx.store.getAll()
  if (runs.some(item => item.status === "running" || item.inFlight)) throw new Error("已有运行中的任务，请先暂停")
  await tx.store.add(run)
  const expired = runs.sort((a, b) => b.createdAt - a.createdAt).slice(19)
  await Promise.all(expired.map(item => tx.store.delete(item.id)))
  await tx.done
  return run
}

export async function changeRun(id: string, update: (run: RunState) => void): Promise<RunState> {
  const tx = (await db()).transaction("runs", "readwrite")
  const run = await tx.store.get(id)
  if (!run) throw new Error("这条任务记录已清除")
  const alreadyRunning = run.status === "running"
  update(run)
  const now = Date.now()
  if (!alreadyRunning && run.status === "running") {
    const others = await tx.store.getAll()
    if (others.some(item => item.id !== id && (item.status === "running" || item.inFlight))) {
      throw new Error("请先暂停其他任务，等待在途操作返回")
    }
    run.activeDurationMs ??= Math.max(0, run.updatedAt - run.createdAt)
    run.activeSince = now
  } else if (alreadyRunning && run.status !== "running") {
    run.activeDurationMs = (run.activeDurationMs ?? 0) + Math.max(0, now - (run.activeSince ?? run.createdAt))
    run.activeSince = undefined
  }
  run.updatedAt = now
  await tx.store.put(run)
  await tx.done
  return run
}

export async function clearRuns(): Promise<void> {
  const tx = (await db()).transaction("runs", "readwrite")
  const runs = await tx.store.getAll()
  if (runs.some(item => item.status === "running" || item.inFlight)) throw new Error("请先暂停当前任务，等待在途操作返回")
  await tx.store.clear()
  await tx.done
}
