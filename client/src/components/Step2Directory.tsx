import { useState } from 'react'
import type { ChapterInfo } from '../App'
import type { ProjectSaveOverrides } from '../App'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

const DEFAULT_CHAPTERS_PER_VOLUME = 20
const ONE_SHOT_MAX_CHAPTERS = 60

type Props = {
  setting: string
  numChapters: number
  directory: string
  setDirectory: (v: string) => void
  parsedChapters: ChapterInfo[]
  setParsedChapters: (v: ChapterInfo[]) => void
  lastGeneratedChapter: number
  setLastGeneratedChapter: (n: number) => void
  directorOutline: string
  setDirectorOutline: (v: string) => void
  onParse: () => Promise<void>
  onGenerated: () => void
  onSave: (overrides?: ProjectSaveOverrides) => void
  onConversation?: (messages: { role: string; content: string }[]) => void
}

export function Step2Directory({
  setting,
  numChapters,
  directory,
  setDirectory,
  parsedChapters,
  setParsedChapters,
  lastGeneratedChapter,
  setLastGeneratedChapter,
  directorOutline,
  setDirectorOutline,
  onParse,
  onGenerated,
  onSave,
  onConversation,
}: Props) {
  const [chaptersPerVolume, setChaptersPerVolume] = useState(DEFAULT_CHAPTERS_PER_VOLUME)
  const [loading, setLoading] = useState(false)
  const [autoRunning, setAutoRunning] = useState(false)
  const [error, setError] = useState('')
  const [lastValidation, setLastValidation] = useState<{ ok: boolean; errors?: string[] } | null>(null)
  const [outlineLoading, setOutlineLoading] = useState(false)

  const totalChapters = Math.max(5, numChapters)
  const useVolumeMode = totalChapters > ONE_SHOT_MAX_CHAPTERS
  const safeChaptersPerVolume = Math.min(20, Math.max(10, chaptersPerVolume || DEFAULT_CHAPTERS_PER_VOLUME))
  const volumeCount = Math.ceil(totalChapters / safeChaptersPerVolume)
  const nextVolumeStart = lastGeneratedChapter + 1
  const nextVolumeEnd = Math.min(lastGeneratedChapter + safeChaptersPerVolume, totalChapters)
  const hasMore = lastGeneratedChapter < totalChapters

  const generateOne = async (volumeStart: number, volumeEnd: number, previousSummary?: string) => {
    const res = await fetch(`${API}/step2-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelSetting: setting,
        numChapters: totalChapters,
        volumeStart,
        volumeEnd,
        previousVolumeSummary: previousSummary || undefined,
      }),
    })
    const data = await parseJsonResponse<{
      ok: boolean
      directory?: string
      error?: string
      messages?: { role: string; content: string }[]
      validation?: { ok: boolean; errors?: string[] }
    }>(res)
    if (!data.ok) throw new Error(data.error || '生成失败')
    if (data.messages?.length) onConversation?.(data.messages)
    if (data.validation) setLastValidation(data.validation)
    return data.directory as string
  }

  const parseAndUpdate = async (newDir: string): Promise<{ maxCh: number; chapters: ChapterInfo[] }> => {
    const parseRes = await fetch(`${API}/directory/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawDirectory: newDir }),
    })
    const parseData = await parseJsonResponse<{ ok: boolean; chapters?: ChapterInfo[] }>(parseRes)
    if (parseData.ok && Array.isArray(parseData.chapters)) {
      setParsedChapters(parseData.chapters)
      const maxCh = Math.max(0, ...parseData.chapters.map((c) => c.number))
      setLastGeneratedChapter(maxCh)
      return { maxCh, chapters: parseData.chapters }
    }
    return { maxCh: 0, chapters: [] }
  }

  const firstFormatIssue = parsedChapters.find(
    (ch) => !ch.role || !ch.purpose || !ch.suspense || !ch.summary || ch.rawBlock.length < 4,
  )

  const rollbackFromChapter = async (chapterNumber: number) => {
    const pattern = new RegExp(`(^|\\n)\\s*第\\s*${chapterNumber}\\s*章`, 'm')
    const match = directory.match(pattern)
    if (!match || match.index == null) return
    const startIndex = match.index + (match[1] ? 1 : 0)
    const nextDir = directory.slice(0, startIndex).trimEnd()
    setDirectory(nextDir)
    const { maxCh } = await parseAndUpdate(nextDir)
    onSave({ directory: nextDir, lastGeneratedChapter: maxCh })
  }

  const generateAll = async () => {
    if (!setting.trim()) {
      setError('请先完成 Step1 生成设定')
      return
    }
    setLoading(true)
    setError('')
    try {
      const text = await generateOne(1, totalChapters)
      setDirectory(text)
      const { maxCh } = await parseAndUpdate(text)
      if (maxCh >= totalChapters) onGenerated()
      onSave({ directory: text, lastGeneratedChapter: maxCh })
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const generateNextVolume = async () => {
    if (!setting.trim()) {
      setError('请先完成 Step1 生成设定')
      return
    }
    if (nextVolumeStart > totalChapters) return
    setLoading(true)
    setError('')
    try {
      const prevSummary = directory.trim().slice(-2000)
      const segment = await generateOne(nextVolumeStart, nextVolumeEnd, prevSummary || undefined)
      const newDir = directory.trim() ? directory.trimEnd() + '\n\n' + segment.trim() : segment.trim()
      setDirectory(newDir)
      const { maxCh } = await parseAndUpdate(newDir)
      onSave({ directory: newDir, lastGeneratedChapter: maxCh })
      if (maxCh >= totalChapters) onGenerated()
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const runFullAuto = async () => {
    if (!setting.trim()) {
      setError('请先完成 Step1 生成设定')
      return
    }
    setAutoRunning(true)
    setError('')
    let currentDir = directory.trim()
    let currentLast = lastGeneratedChapter
    try {
      while (currentLast < totalChapters) {
        const start = currentLast + 1
        const end = Math.min(currentLast + safeChaptersPerVolume, totalChapters)
        const prevSummary = currentDir.slice(-2000)
        const segment = await generateOne(start, end, prevSummary || undefined)
        currentDir = currentDir ? currentDir + '\n\n' + segment.trim() : segment.trim()
        setDirectory(currentDir)
        const { maxCh } = await parseAndUpdate(currentDir)
        currentLast = maxCh
        onSave({ directory: currentDir, lastGeneratedChapter: maxCh })
        if (maxCh >= totalChapters) {
          onGenerated()
          break
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setAutoRunning(false)
    }
  }

  const generateDirectorOutline = async () => {
    if (!setting.trim()) {
      setError('请先完成 Step1 生成设定')
      return
    }
    setOutlineLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/outline/director`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelSetting: setting,
          numChapters: totalChapters,
          wordPerChapter: 2000,
          existingDirectory: directory.slice(0, 2500) || undefined,
        }),
      })
      const data = await parseJsonResponse<{ ok: boolean; outline?: string; error?: string; messages?: { role: string; content: string }[] }>(res)
      if (!data.ok) throw new Error(data.error || '生成失败')
      if (data.messages?.length) onConversation?.(data.messages)
      setDirectorOutline(data.outline || '')
      onSave({ directorOutline: data.outline || '' })
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setOutlineLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Step2 生成目录（大纲）</h2>
      <p className="muted">
        总章节数 {totalChapters} 章（约 {(totalChapters * 2000) / 10000} 万字）
        {useVolumeMode && ` · 分批生成，每批最多 ${safeChaptersPerVolume} 章（后端按 5 章小段校验），共约 ${volumeCount} 批`}
      </p>
      {useVolumeMode && (
        <div className="form-row">
          <label className="label">每批章数（建议 20，单次过多易丢章）</label>
          <input
            className="input"
            type="number"
            min={10}
            max={20}
            value={safeChaptersPerVolume}
            onChange={(e) =>
              setChaptersPerVolume(Math.min(20, Math.max(10, Number(e.target.value) || 20)))
            }
          />
        </div>
      )}
      <div className="form-row">
        {!useVolumeMode && (
          <button className="btn primary" onClick={generateAll} disabled={loading}>
            {loading ? '生成中…' : '生成全部目录'}
          </button>
        )}
        {useVolumeMode && (
          <>
            <span className="muted" style={{ marginRight: '0.75rem' }}>
              已生成到第 {lastGeneratedChapter} 章 / 共 {totalChapters} 章
            </span>
            {lastGeneratedChapter > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setLastGeneratedChapter(0)
                  onSave()
                }}
                title="重置进度，下次将从第 1 章开始生成"
                style={{ marginRight: '0.5rem' }}
              >
                清空进度
              </button>
            )}
            <button
              className="btn primary"
              onClick={generateNextVolume}
              disabled={loading || autoRunning || !hasMore}
            >
              {loading ? '生成中…' : hasMore ? `生成下一批（第 ${nextVolumeStart}–${nextVolumeEnd} 章）` : '已全部生成'}
            </button>
            <button
              className="btn"
              onClick={runFullAuto}
              disabled={loading || autoRunning || !hasMore}
              title="自动按卷生成直到全部完成"
              style={{ marginLeft: '0.5rem' }}
            >
              {autoRunning ? `生成中… ${lastGeneratedChapter}/${totalChapters}` : '全自动生成大纲'}
            </button>
            {(lastGeneratedChapter > 0 || directory) && (
              <button type="button" className="btn" onClick={() => onParse()} style={{ marginLeft: '0.5rem' }}>
                解析目录
              </button>
            )}
          </>
        )}
        {!useVolumeMode && directory && (
          <button type="button" className="btn" onClick={() => onParse()} style={{ marginLeft: '0.5rem' }}>
            解析目录
          </button>
        )}
        <button type="button" className="btn" onClick={() => onSave()} style={{ marginLeft: '0.5rem' }}>保存</button>
        {error && <span className="error" style={{ marginLeft: '0.75rem' }}>{error}</span>}
      </div>
      {directory && (
        <>
          <div className="form-row">
            <label className="label">目录内容（可编辑，分卷会追加在下方）</label>
            <textarea
              className="textarea"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              rows={16}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
            />
          </div>
          {lastValidation && (
            <p className={lastValidation.ok ? 'success' : 'error'}>
              {lastValidation.ok ? '校验通过' : `校验未完全通过，已尝试自动修正：${(lastValidation.errors || []).join(' ')}`}
            </p>
          )}
          {firstFormatIssue && (
            <p className="error" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              第 {firstFormatIssue.number} 章开始目录格式不完整，建议回退到上一章后重新生成。
              <button type="button" className="btn" onClick={() => rollbackFromChapter(firstFormatIssue.number)}>
                回退到第 {firstFormatIssue.number - 1} 章
              </button>
            </p>
          )}
          {parsedChapters.length > 0 && (
            <p className="success">已解析 {parsedChapters.length} 章，Step3 可选章写稿。</p>
          )}
        </>
      )}

      <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border, #333)', paddingTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem' }}>🎬 导演式顶层大纲（推荐：写章前先生成）</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          以导演思维规划全书：卖点承诺 → 黄金三章方案 → 分卷蓝图（起承转合/爽点高峰/卷尾钩）→ 爽点节奏表 → 伏笔网络 → 人物弧光 → 结局方案。生成后 Step3 写章时会按此执行。
        </p>
        <div className="form-row">
          <button
            type="button"
            className="btn primary"
            onClick={generateDirectorOutline}
            disabled={outlineLoading}
          >
            {outlineLoading ? '生成中（约 1-2 分钟）…' : directorOutline ? '重新生成导演大纲' : '生成导演大纲'}
          </button>
          {directorOutline && (
            <button type="button" className="btn" onClick={() => onSave({ directorOutline })} style={{ marginLeft: '0.5rem' }}>
              保存大纲
            </button>
          )}
        </div>
        {directorOutline && (
          <textarea
            className="textarea"
            value={directorOutline}
            onChange={(e) => setDirectorOutline(e.target.value)}
            rows={14}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', marginTop: '0.5rem' }}
          />
        )}
      </div>
    </div>
  )
}
