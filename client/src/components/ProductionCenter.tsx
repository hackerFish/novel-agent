import { useState, useEffect, useRef } from 'react'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type BatchTask = {
  bookId: string
  running: boolean
  current: number
  target: number
  message: string
  stopRequested?: boolean
  startedAt?: string
  finishedAt?: string
}

type Props = {
  bookId: string
  totalChapters: number
  lastGeneratedChapter: number
  onProgress?: (current: number) => void
}

/** 生产中心：批量生成到目标章（细纲→正文→质检→定稿 全自动），实时进度，可暂停 */
export function ProductionCenter({ bookId, totalChapters, lastGeneratedChapter, onProgress }: Props) {
  const [target, setTarget] = useState(0)
  const [task, setTask] = useState<BatchTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API}/book/batch-generate/status?bookId=${encodeURIComponent(bookId)}`)
      const data = await parseJsonResponse<{ ok: boolean; task?: BatchTask | null }>(res)
      setTask(data.task || null)
      if (data.task && typeof data.task.current === 'number') onProgress?.(data.task.current)
      if (data.task && !data.task.running) {
        stopPolling()
        setBusy(false)
      }
    } catch { /* 轮询失败忽略 */ }
  }

  const start = async () => {
    if (!target || target <= lastGeneratedChapter) {
      setError(`目标章数需大于当前进度（${lastGeneratedChapter}）`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/book/batch-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, toChapter: target }),
      })
      const data = await parseJsonResponse<{ ok: boolean; task?: BatchTask; error?: string; alreadyRunning?: boolean }>(res)
      if (!data.ok) throw new Error(data.error || '启动失败')
      setTask(data.task || null)
      stopPolling()
      pollingRef.current = setInterval(fetchStatus, 5000)
    } catch (e) {
      setError((e as Error).message || '启动失败')
      setBusy(false)
    }
  }

  const stop = async () => {
    try {
      await fetch(`${API}/book/batch-generate/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      setTask((t) => (t ? { ...t, stopRequested: true, message: '正在停止…' } : t))
    } catch { /* ignore */ }
  }

  useEffect(() => () => stopPolling(), [])

  const running = !!task?.running
  const percent = task && task.target ? Math.min(100, Math.round(((task.current || 0) / task.target) * 100)) : 0

  return (
    <div className="production-center" style={{ border: '1px solid var(--border, #333)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <strong>⚡ 生产中心</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          当前进度：第 {lastGeneratedChapter} / {totalChapters} 章
        </span>
        <input
          className="input"
          type="number"
          min={lastGeneratedChapter + 1}
          max={totalChapters}
          value={target || ''}
          onChange={(e) => setTarget(Number(e.target.value))}
          placeholder={`目标章（≤${totalChapters}）`}
          style={{ width: 120 }}
          disabled={running}
        />
        {!running ? (
          <button className="btn primary" onClick={start} disabled={busy || !target}>
            {busy ? '启动中…' : '🚀 一键生产到目标章'}
          </button>
        ) : (
          <button className="btn danger" onClick={stop}>⏸ 暂停</button>
        )}
        {running && (
          <button className="btn" onClick={fetchStatus} style={{ marginLeft: '0.25rem' }}>刷新进度</button>
        )}
      </div>
      {running && task && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
            <span>第 {task.current} / {task.target} 章</span>
            <span>{percent}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent}%`, background: 'linear-gradient(90deg, #C3272B, #F5A623)', transition: 'width 0.5s' }} />
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0 0' }}>{task.message}</p>
        </div>
      )}
      {task && !running && task.message && (
        <p style={{ fontSize: '0.85rem', margin: '0.5rem 0 0', color: 'var(--success, #4caf50)' }}>
          {task.message}（{task.finishedAt ? '已结束' : ''}）
        </p>
      )}
      {error && <p className="error" style={{ margin: '0.35rem 0 0' }}>{error}</p>}
    </div>
  )
}
