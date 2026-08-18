import { useMemo, useState } from 'react'
import type {
  ChapterInfo,
  ProjectSaveOverrides,
  PublishConfig,
  PublishState,
  PublishStatus,
} from '../App'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Props = {
  bookId: string
  bookTitle: string
  parsedChapters: ChapterInfo[]
  draftedChapters: Record<number, string>
  publishStates: Record<number, PublishState>
  setPublishStates: (v: Record<number, PublishState>) => void
  publishConfig: PublishConfig
  setPublishConfig: (v: PublishConfig) => void
  onSave: (overrides?: ProjectSaveOverrides) => void | Promise<void>
}

type QualityResult = {
  level: 'ok' | 'warn' | 'bad'
  issues: string[]
}

type ScheduleRow = {
  chapterNumber: number
  title: string
  scheduledAt: string
  wordCount: number
  quality: string
  status: string
}

const statusLabels: Record<PublishStatus, string> = {
  draft: '未发布',
  copied: '已复制待发布',
  published: '已发布',
  approved: '审核通过',
  needs_fix: '需要修改',
}

function countWords(text: string) {
  return text.replace(/\s/g, '').length
}

function buildChapterTitle(chapter: ChapterInfo | undefined, number: number) {
  const title = (chapter?.title || '').trim()
  if (!title) return `第${number}章`
  if (/^第\s*\d+/.test(title)) return title
  return `第${number}章 ${title}`
}

function maxUnpunctuatedRun(text: string) {
  const punctuation = new Set('，。！？；：、,.!?;:\n\r')
  let max = 0
  let current = 0
  for (const char of text) {
    if (punctuation.has(char) || /\s/.test(char)) {
      max = Math.max(max, current)
      current = 0
    } else {
      current += 1
    }
  }
  return Math.max(max, current)
}

function qualityCheck(content: string): QualityResult {
  const issues: string[] = []
  const trimmed = content.trim()
  const words = countWords(trimmed)

  if (!trimmed) issues.push('正文为空，不能发布')
  if (words > 0 && words < 1800) issues.push(`字数偏少：约 ${words} 字，建议单章 2000-2200 字`)
  if (maxUnpunctuatedRun(trimmed) > 120) issues.push('存在超长无标点段落，建议先修正断句')

  const outlineLeaks = ['本章定位', '核心作用', '悬念密度', '本章简述', '生成失败', 'AI生成', '作为AI']
  const leaked = outlineLeaks.filter((keyword) => trimmed.includes(keyword))
  if (leaked.length) issues.push(`疑似大纲/AI残留：${leaked.join('、')}`)

  const paragraphs = trimmed.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const repeated = paragraphs.find((p, index) => p.length > 40 && paragraphs.indexOf(p) !== index)
  if (repeated) issues.push('发现重复段落，建议发布前检查')

  if (issues.some((issue) => issue.includes('为空') || issue.includes('残留'))) {
    return { level: 'bad', issues }
  }
  if (issues.length) return { level: 'warn', issues }
  return { level: 'ok', issues: ['格式检查通过，可以复制到番茄后台发布'] }
}

function isPublished(status?: PublishStatus) {
  return status === 'published' || status === 'approved'
}

export function Step5Publish({
  bookId,
  bookTitle,
  parsedChapters,
  draftedChapters,
  publishStates,
  setPublishStates,
  publishConfig,
  setPublishConfig,
  onSave,
}: Props) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [schedulePreview, setSchedulePreview] = useState<ScheduleRow[]>([])
  const [showUnpublishedOnly, setShowUnpublishedOnly] = useState(true)
  const [continuousMode, setContinuousMode] = useState(false)
  const [continuousIndex, setContinuousIndex] = useState(0)
  const [autoStatus, setAutoStatus] = useState<{ loggedIn?: boolean; schedulerRunning?: boolean }>({})
  const [autoBusy, setAutoBusy] = useState(false)

  const chapterMap = useMemo(() => new Map(parsedChapters.map((c) => [c.number, c])), [parsedChapters])
  const chapterNumbers = useMemo(
    () => Object.keys(draftedChapters).map(Number).sort((a, b) => a - b),
    [draftedChapters]
  )

  const unpublishedNumbers = useMemo(
    () => chapterNumbers.filter((n) => !isPublished(publishStates[n]?.status)),
    [chapterNumbers, publishStates]
  )

  const queueNumbers = useMemo(() => {
    let nums = chapterNumbers.filter((n) => n >= publishConfig.startChapter)
    if (publishConfig.onlyUnpublished) nums = nums.filter((n) => !isPublished(publishStates[n]?.status))
    return nums
  }, [chapterNumbers, publishConfig, publishStates])

  const displayNumbers = showUnpublishedOnly ? unpublishedNumbers : chapterNumbers

  const updateState = (chapterNumber: number, patch: PublishState) => {
    const next = { ...publishStates, [chapterNumber]: patch }
    setPublishStates(next)
    onSave({ publishStates: next })
  }

  const saveConfig = (patch: Partial<PublishConfig>) => {
    const next = { ...publishConfig, ...patch }
    setPublishConfig(next)
    onSave({ publishConfig: next })
  }

  const copyText = async (text: string, successText: string) => {
    await navigator.clipboard.writeText(text)
    setMessage(successText)
    window.setTimeout(() => setMessage(''), 2000)
  }

  const copyChapter = async (number: number, markCopied = true) => {
    const title = buildChapterTitle(chapterMap.get(number), number)
    const content = (draftedChapters[number] || '').trim()
    await copyText(`${title}\n\n${content}`, `第 ${number} 章标题和正文已复制`)
    if (markCopied) updateState(number, { ...publishStates[number], status: 'copied' })
  }

  const previewSchedule = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/publish/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, config: publishConfig }),
      })
      const data = await parseJsonResponse<{ ok: boolean; schedule?: ScheduleRow[]; error?: string }>(res)
      if (!data.ok || !data.schedule) throw new Error(data.error || '排程预览失败')
      setSchedulePreview(data.schedule)
      setMessage(`已生成 ${data.schedule.length} 章发布排程`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const applySchedule = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/publish/apply-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, config: publishConfig }),
      })
      const data = await parseJsonResponse<{ ok: boolean; publishStates?: Record<number, PublishState>; applied?: number; error?: string }>(res)
      if (!data.ok || !data.publishStates) throw new Error(data.error || '写入排程失败')
      setPublishStates(data.publishStates)
      await onSave({ publishStates: data.publishStates, publishConfig })
      setMessage(`已为 ${data.applied || 0} 章写入建议发布时间`)
      await previewSchedule()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const downloadBatchZip = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/publish/batch-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, config: publishConfig }),
      })
      if (!res.ok) {
        const data = await parseJsonResponse<{ error?: string }>(res)
        throw new Error(data.error || '导出失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${bookTitle}_番茄发布包.zip`
      a.click()
      URL.revokeObjectURL(url)
      setMessage('批量发布包已下载（含分章 txt + 排程 CSV）')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const currentContinuousChapter = queueNumbers[continuousIndex]
  const currentContinuousSchedule = schedulePreview.find((r) => r.chapterNumber === currentContinuousChapter)

  const startContinuous = async () => {
    if (!schedulePreview.length) await previewSchedule()
    setContinuousIndex(0)
    setContinuousMode(true)
  }

  const continuousCopyTitle = async () => {
    if (!currentContinuousChapter) return
    const title = buildChapterTitle(chapterMap.get(currentContinuousChapter), currentContinuousChapter)
    await copyText(title, `第 ${currentContinuousChapter} 章标题已复制，请粘贴到番茄后台`)
  }

  const continuousCopyBody = async () => {
    if (!currentContinuousChapter) return
    const content = (draftedChapters[currentContinuousChapter] || '').trim()
    await copyText(content, `第 ${currentContinuousChapter} 章正文已复制，请粘贴到番茄后台`)
  }

  const continuousMarkDone = async () => {
    if (!currentContinuousChapter) return
    updateState(currentContinuousChapter, {
      ...publishStates[currentContinuousChapter],
      status: 'published',
      publishedAt: new Date().toISOString(),
    })
    if (continuousIndex + 1 >= queueNumbers.length) {
      setContinuousMode(false)
      setMessage('连续发布完成，全部待发布章节已处理')
      return
    }
    setContinuousIndex((i) => i + 1)
    setMessage(`第 ${currentContinuousChapter} 章已标记发布，进入下一章`)
  }

  if (!chapterNumbers.length) {
    return (
      <div className="card">
        <h2>Step5 发布助手</h2>
        <p className="muted">这里会显示已经生成的章节。先去 Step3 写章节，再回来批量排程和发布。</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Step5 番茄批量发布</h2>
      <p className="muted">
        番茄作家后台暂无公开批量上传 API。本页提供：<strong>批量排程</strong>、<strong>ZIP 发布包</strong>、<strong>连续发布助手</strong>，减少你一章章新建定时的重复劳动。
      </p>

      <section className="publish-batch-panel">
        <h3>批量排程设置</h3>
        <div className="publish-batch-grid">
          <label>
            <span className="label">起始日期</span>
            <input
              className="input"
              type="date"
              value={publishConfig.startDate}
              onChange={(e) => saveConfig({ startDate: e.target.value })}
            />
          </label>
          <label>
            <span className="label">从第几章开始</span>
            <input
              className="input"
              type="number"
              min={1}
              value={publishConfig.startChapter}
              onChange={(e) => saveConfig({ startChapter: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label>
            <span className="label">每日发布章数</span>
            <select
              className="input"
              value={publishConfig.chaptersPerDay}
              onChange={(e) => saveConfig({ chaptersPerDay: Number(e.target.value) === 1 ? 1 : 2 })}
            >
              <option value={2}>2 章（推荐：12:00 + 20:30）</option>
              <option value={1}>1 章</option>
            </select>
          </label>
          <label>
            <span className="label">时段 1</span>
            <input
              className="input"
              type="time"
              value={publishConfig.timeSlots[0] || '12:00'}
              onChange={(e) => saveConfig({ timeSlots: [e.target.value, publishConfig.timeSlots[1] || '20:30'] })}
            />
          </label>
          <label>
            <span className="label">时段 2</span>
            <input
              className="input"
              type="time"
              value={publishConfig.timeSlots[1] || '20:30'}
              disabled={publishConfig.chaptersPerDay === 1}
              onChange={(e) => saveConfig({ timeSlots: [publishConfig.timeSlots[0] || '12:00', e.target.value] })}
            />
          </label>
        </div>

        <label className="publish-checkbox">
          <input
            type="checkbox"
            checked={publishConfig.onlyUnpublished}
            onChange={(e) => saveConfig({ onlyUnpublished: e.target.checked })}
          />
          仅排程/导出未发布章节（已发布的不重复导出）
        </label>

        <div className="publish-batch-actions">
          <button type="button" className="btn" onClick={previewSchedule} disabled={loading}>
            预览排程
          </button>
          <button type="button" className="btn" onClick={applySchedule} disabled={loading}>
            写入排程到各章
          </button>
          <button type="button" className="btn primary" onClick={downloadBatchZip} disabled={loading}>
            下载批量发布包 ZIP
          </button>
          <button type="button" className="btn primary" onClick={startContinuous} disabled={loading || !queueNumbers.length}>
            连续发布助手
          </button>
        </div>

        <p className="muted publish-batch-hint">
          ZIP 内含：每章独立 txt（标题+正文）、publish-schedule.csv（建议定时）、README 说明。待发布 {queueNumbers.length} 章。
        </p>
      </section>

      {continuousMode && currentContinuousChapter && (
        <section className="publish-continuous">
          <h3>连续发布助手 ({continuousIndex + 1}/{queueNumbers.length})</h3>
          <p><strong>{buildChapterTitle(chapterMap.get(currentContinuousChapter), currentContinuousChapter)}</strong></p>
          <p className="muted">
            建议定时：{publishStates[currentContinuousChapter]?.scheduledAt || currentContinuousSchedule?.scheduledAt || '请先点「写入排程到各章」'}
          </p>
          <ol className="publish-continuous-steps">
            <li>番茄后台 → 新建章节 → 点「复制标题」粘贴</li>
            <li>点「复制正文」粘贴到正文框</li>
            <li>设置定时发布为上方建议时间</li>
            <li>保存后点「已发布，下一章」</li>
          </ol>
          <div className="publish-actions">
            <button type="button" className="btn" onClick={continuousCopyTitle}>复制标题</button>
            <button type="button" className="btn" onClick={continuousCopyBody}>复制正文</button>
            <button type="button" className="btn primary" onClick={() => copyChapter(currentContinuousChapter)}>复制标题+正文</button>
            <button type="button" className="btn primary" onClick={continuousMarkDone}>已发布，下一章</button>
            <button type="button" className="btn" onClick={() => setContinuousMode(false)}>退出助手</button>
          </div>
        </section>
      )}

      {schedulePreview.length > 0 && (
        <section className="publish-schedule-preview">
          <h3>排程预览（前 10 章）</h3>
          <table className="publish-schedule-table">
            <thead>
              <tr>
                <th>章</th>
                <th>标题</th>
                <th>建议发布时间</th>
                <th>字数</th>
              </tr>
            </thead>
            <tbody>
              {schedulePreview.slice(0, 10).map((row) => (
                <tr key={row.chapterNumber}>
                  <td>{row.chapterNumber}</td>
                  <td>{row.title}</td>
                  <td>{row.scheduledAt}</td>
                  <td>{row.wordCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {schedulePreview.length > 10 && (
            <p className="muted">…共 {schedulePreview.length} 章，完整列表见 ZIP 内 CSV</p>
          )}
        </section>
      )}

      <div className="publish-summary">
        <div>
          <strong>待发布</strong>
          <span>{unpublishedNumbers.length} 章</span>
        </div>
        <div>
          <strong>已发布</strong>
          <span>{chapterNumbers.length - unpublishedNumbers.length} 章</span>
        </div>
        <div>
          <label className="publish-checkbox">
            <input type="checkbox" checked={showUnpublishedOnly} onChange={(e) => setShowUnpublishedOnly(e.target.checked)} />
            列表只显示待发布
          </label>
        </div>
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}

      <div className="publish-list">
        {displayNumbers.map((number) => {
          const chapter = chapterMap.get(number)
          const content = draftedChapters[number] || ''
          const wordCount = countWords(content)
          const quality = qualityCheck(content)
          const state = publishStates[number] || { status: 'draft' as PublishStatus }
          const title = buildChapterTitle(chapter, number)

          return (
            <article key={number} className={`publish-item publish-item--${quality.level}`}>
              <div className="publish-item__head">
                <div>
                  <h3>{title}</h3>
                  <p className="muted">
                    约 {wordCount} 字 · {statusLabels[state.status]}
                    {state.scheduledAt ? ` · 建议 ${state.scheduledAt}` : ''}
                  </p>
                </div>
                <select
                  className="input publish-status"
                  value={state.status}
                  onChange={(e) => {
                    const status = e.target.value as PublishStatus
                    updateState(number, {
                      ...state,
                      status,
                      publishedAt: isPublished(status) ? new Date().toISOString() : state.publishedAt,
                    })
                  }}
                >
                  {(Object.keys(statusLabels) as PublishStatus[]).map((status) => (
                    <option key={status} value={status}>{statusLabels[status]}</option>
                  ))}
                </select>
              </div>

              <ul className="publish-checks">
                {quality.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>

              <div className="publish-actions">
                <button type="button" className="btn" onClick={() => copyText(title, `第 ${number} 章标题已复制`)}>复制标题</button>
                <button type="button" className="btn" onClick={() => copyText(content.trim(), `第 ${number} 章正文已复制`)}>复制正文</button>
                <button type="button" className="btn primary" onClick={() => copyChapter(number)}>复制标题+正文</button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => updateState(number, { ...state, status: 'published', publishedAt: new Date().toISOString() })}
                >
                  标记已发布
                </button>
              </div>
            </article>
          )
        })}
      </div>

      <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border, #333)', paddingTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>🤖 自动发布（浏览器自动化）</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          番茄无公开批量 API，本功能用 Playwright 打开真实浏览器模拟人工操作。首次使用请点「登录番茄」：浏览器会弹出，手动登录（扫码/账密）后登录态自动保存；之后即可自动发布或按排程定时发布。
        </p>
        <div className="form-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setAutoBusy(true)
              try {
                const res = await fetch(`${API}/publish/auto/status`)
                const data = await parseJsonResponse<{ ok: boolean; loggedIn?: boolean; schedulerRunning?: boolean; error?: string }>(res)
                setAutoStatus(data)
              } catch { /* ignore */ }
              setAutoBusy(false)
            }}
            disabled={autoBusy}
          >
            刷新状态
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              setAutoBusy(true)
              setError('')
              try {
                const res = await fetch(`${API}/publish/auto/login`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ timeoutMs: 300000 }),
                })
                const data = await parseJsonResponse<{ ok: boolean; error?: string }>(res)
                if (!data.ok) throw new Error(data.error || '登录失败')
                setMessage('✅ 番茄登录成功，登录态已保存')
                setAutoStatus({ ...autoStatus, loggedIn: true })
              } catch (e) {
                setError((e as Error).message || '登录失败')
              } finally {
                setAutoBusy(false)
              }
            }}
            disabled={autoBusy}
          >
            {autoBusy ? '处理中…' : '登录番茄'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const n = Number(prompt('要自动发布的章节号：') || '0')
              if (!n || !draftedChapters[n]) { setError('无效章节号或该章未写'); return }
              setAutoBusy(true)
              setError('')
              try {
                const res = await fetch(`${API}/publish/auto/publish`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bookId, chapterNumber: n }),
                })
                const data = await parseJsonResponse<{ ok: boolean; error?: string; chapterNumber?: number }>(res)
                if (!data.ok) throw new Error(data.error || '发布失败')
                setMessage(`✅ 第 ${data.chapterNumber} 章已发布到番茄`)
                updateState(n, { ...publishStates[n], status: 'published', publishedAt: new Date().toISOString(), note: '自动发布' })
              } catch (e) {
                setError((e as Error).message || '发布失败')
              } finally {
                setAutoBusy(false)
              }
            }}
            disabled={autoBusy || !autoStatus.loggedIn}
          >
            立即发布一章
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setAutoBusy(true)
              try {
                const res = await fetch(`${API}/publish/auto/scheduler/start`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bookId }),
                })
                const data = await parseJsonResponse<{ ok: boolean; queued?: number; error?: string }>(res)
                if (!data.ok) throw new Error(data.error || '调度启动失败')
                setMessage(`✅ 调度已启动，队列 ${data.queued || 0} 章（每 60 秒检查一次，到点自动发布）`)
              } catch (e) {
                setError((e as Error).message || '启动失败')
              } finally {
                setAutoBusy(false)
              }
            }}
            disabled={autoBusy || !autoStatus.loggedIn}
          >
            启动定时调度
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              try {
                await fetch(`${API}/publish/auto/scheduler/stop`, { method: 'POST' })
                setMessage('调度已停止')
              } catch { /* ignore */ }
            }}
          >
            停止调度
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
          状态：{autoStatus.loggedIn === undefined ? '未检测（点刷新状态）' : autoStatus.loggedIn ? '✅ 已登录番茄' : '未登录'}
          {autoStatus.schedulerRunning ? ' · 🔄 调度运行中' : ''}
          <span className="muted" style={{ marginLeft: '0.75rem' }}>
            提示：先「写入排程到各章」再「启动定时调度」即可实现自动定时发布；发布前请先写好导演大纲与细纲保证质量。
          </span>
        </p>
      </div>
    </div>
  )
}
