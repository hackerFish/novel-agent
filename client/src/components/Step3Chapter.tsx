import { useRef, useState } from 'react'
import type { ChapterInfo, ProjectSaveOverrides } from '../App'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Props = {
  currentBookId: string
  topic: string
  voiceCard: string
  setting: string
  directory: string
  parsedChapters: ChapterInfo[]
  wordPerChapter: number
  globalSummary: string
  setGlobalSummary: (v: string) => void
  characterState: string
  setCharacterState: (v: string) => void
  draftedChapters: Record<number, string>
  setDraftedChapters: (v: Record<number, string>) => void
  setLastGeneratedChapter: (v: number) => void
  consistencyResult: string
  setConsistencyResult: (v: string) => void
  directorOutline?: string
  onFinalize: (chapterNumber?: number) => void
  onSave: (overrides?: ProjectSaveOverrides) => void | Promise<void>
  onConversation?: (messages: { role: string; content: string }[]) => void
}

type ChapterQuality = {
  ok: boolean
  repaired?: boolean
  issues?: string[]
  maxRun?: number
  paragraphCount?: number
  charCount?: number
  targetChars?: number
  shortChapter?: boolean
  shortChapterWarning?: string
  expandedFromShortDraft?: boolean
}

type ChapterResponse = {
  ok: boolean
  content?: string
  error?: string
  quality?: ChapterQuality
  messages?: { role: string; content: string }[]
}

type ConsistencyResponse = {
  ok: boolean
  result?: string
  error?: string
}

type ConsistencyRepairResponse = {
  ok: boolean
  passed?: boolean
  changed?: boolean
  content?: string
  initialReview?: string
  review?: string
  quality?: ChapterQuality
  error?: string
}

type FormatResponse = {
  ok: boolean
  content?: string
  quality?: ChapterQuality
  error?: string
}

type SummaryResponse = {
  ok: boolean
  summary?: string
  error?: string
}

type CharacterResponse = {
  ok: boolean
  characterState?: string
  error?: string
}

type PipelineResponse = {
  ok: boolean
  content?: string
  summary?: string
  characterState?: string
  error?: string
  quality?: ChapterQuality & { tomatoLocalScore?: number }
  consistencyReview?: string
  messages?: { role: string; content: string }[]
}

export function Step3Chapter({
  currentBookId,
  topic,
  voiceCard,
  setting,
  parsedChapters,
  wordPerChapter,
  globalSummary,
  setGlobalSummary,
  characterState,
  setCharacterState,
  draftedChapters,
  setDraftedChapters,
  setLastGeneratedChapter,
  consistencyResult,
  setConsistencyResult,
  directorOutline,
  onFinalize,
  onSave,
  onConversation,
}: Props) {
  const [chapterNumber, setChapterNumber] = useState(1)
  const [userGuidance, setUserGuidance] = useState('')
  const [humanizeStrength, setHumanizeStrength] = useState(0.6)
  const [autoConsistency, setAutoConsistency] = useState(false)
  const [content, setContent] = useState('')
  const [chapterOutline, setChapterOutline] = useState('')
  const [outlineLoading, setOutlineLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formatNotice, setFormatNotice] = useState('')
  const [autoRunning, setAutoRunning] = useState(false)
  const [stopAuto, setStopAuto] = useState(false)
  const [autoStatus, setAutoStatus] = useState('')
  const stopAutoRef = useRef(false)

  const chapterInfo = parsedChapters.find((c) => c.number === chapterNumber) || null
  const maxChapter = parsedChapters.reduce((max, c) => Math.max(max, c.number), 0)
  const displayContent = content || draftedChapters[chapterNumber] || ''
  const wordCount = displayContent.replace(/\s/g, '').length

  const buildChapterOptions = (
    targetChapter: number,
    drafts: Record<number, string>,
    summary: string,
    characters: string
  ) => {
    const info = parsedChapters.find((c) => c.number === targetChapter) || null
    const next = parsedChapters.find((c) => c.number === targetChapter + 1) || null
    const outlineWindow = parsedChapters
      .filter((c) => c.number >= targetChapter - 3 && c.number <= targetChapter + 3)
      .map((c) => `第${c.number}章 ${c.title}：${c.summary || c.purpose || ''}`)
      .join('\n')

    return {
      chapterNumber: targetChapter,
      title: info?.title || `第${targetChapter}章`,
      chapterRole: info?.role || '',
      chapterPurpose: info?.purpose || '',
      chapterSummary: info?.summary || '',
      novelSetting: setting.slice(0, 8000),
      globalSummary: targetChapter === 1 ? undefined : summary.slice(-16000),
      previousExcerpt: targetChapter > 1 && drafts[targetChapter - 1] ? drafts[targetChapter - 1].slice(-4000) : undefined,
      characterState: characters ? characters.slice(-8000) : undefined,
      outlineWindow: outlineWindow || undefined,
      nextChapterTitle: next?.title,
      nextChapterSummary: next?.summary,
      wordNumber: wordPerChapter || 2000,
      userGuidance: userGuidance || undefined,
      humanizeStrength,
      topic,
      voiceCard: voiceCard || undefined,
      chapterOutline: chapterOutline || undefined,
    }
  }

  const formatQualityNotice = (quality?: ChapterQuality & { tomatoLocalScore?: number }) => {
    if (!quality) return ''
    const tomatoNote = typeof quality.tomatoLocalScore === 'number'
      ? `番茄本地追读分 ${quality.tomatoLocalScore}/10。`
      : ''
    if (quality.shortChapterWarning) return `${tomatoNote}${quality.shortChapterWarning}`
    if (quality.shortChapter) {
      return `${tomatoNote}章节偏短：当前约 ${quality.charCount || 0} 字，目标约 ${quality.targetChars || wordPerChapter || 2000} 字`
    }
    if (quality.repaired && quality.ok) return `${tomatoNote}已自动修复断句和分段。`
    if (quality.repaired) return `${tomatoNote}已尝试自动修复，仍需检查：${quality.issues?.join('；') || '格式风险'}`
    if (!quality.ok) return `${tomatoNote}格式仍需检查：${quality.issues?.join('；') || '未知问题'}`
    return tomatoNote
  }

  const formatQualityIssues = (quality?: ChapterQuality) => {
    const issues = [...(quality?.issues || [])]
    if (quality?.shortChapterWarning) issues.unshift(quality.shortChapterWarning)
    return issues.join('；') || '未知格式问题'
  }

  const generateOneChapter = async (
    targetChapter: number,
    drafts: Record<number, string>,
    summary: string,
    characters: string
  ) => {
    const res = await fetch(`${API}/step3-chapter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildChapterOptions(targetChapter, drafts, summary, characters)),
    })
    const data = await parseJsonResponse<ChapterResponse>(res)
    if (!data.ok || !data.content) throw new Error(data.error || `第${targetChapter}章生成失败`)
    if (data.messages?.length) onConversation?.(data.messages)
    return data
  }

  const checkOneChapter = async (chapterText: string, summary: string, characters: string) => {
    const res = await fetch(`${API}/check-consistency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterText,
        globalSummary: summary.slice(-8000),
        characterState: characters.slice(-4000),
      }),
    })
    const data = await parseJsonResponse<ConsistencyResponse>(res)
    if (!data.ok) throw new Error(data.error || '一致性校验失败')
    return data.result || ''
  }

  const repairOneChapterConsistency = async (
    chapterText: string,
    summary: string,
    characters: string,
    reviewText = ''
  ) => {
    const res = await fetch(`${API}/chapter/consistency-repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterText,
        globalSummary: summary.slice(-8000),
        characterState: characters.slice(-4000),
        reviewText,
      }),
    })
    const data = await parseJsonResponse<ConsistencyRepairResponse>(res)
    if (!data.ok) throw new Error(data.error || '一致性修稿失败')
    return { ...data, ok: data.passed ?? data.ok }
  }

  const formatConsistencyRepairNotice = (result: ConsistencyRepairResponse) => {
    if (!result.changed) return result.review || result.initialReview || '未发现矛盾'
    return [
      '初审发现：',
      result.initialReview || '未提供审校结果',
      '',
      result.ok ? '已按审校结果自动修稿，复审结果：' : '已尝试自动修稿，但复审仍有问题：',
      result.review || '未发现矛盾',
    ].join('\n')
  }

  const formatOneChapter = async (chapterText: string) => {
    const res = await fetch(`${API}/chapter/format`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterText }),
    })
    const data = await parseJsonResponse<FormatResponse>(res)
    if (!data.ok || !data.content) throw new Error(data.error || '格式整理失败')
    return data
  }

  const finalizeOneChapter = async (chapterText: string, summary: string, characters: string) => {
    const [summaryRes, characterRes] = await Promise.all([
      fetch(`${API}/step4-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterText, currentSummary: summary }),
      }),
      fetch(`${API}/step4-character-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterText, oldCharacterState: characters, initialCharacterDynamics: setting.slice(0, 2000) }),
      }),
    ])

    const summaryData = await parseJsonResponse<SummaryResponse>(summaryRes)
    const characterData = await parseJsonResponse<CharacterResponse>(characterRes)
    if (!summaryData.ok) throw new Error(summaryData.error || 'Step4 前文摘要更新失败')
    if (!characterData.ok) throw new Error(characterData.error || 'Step4 角色状态更新失败')
    return {
      summary: summaryData.summary || summary,
      characters: characterData.characterState || characters,
    }
  }

  const runPipelineChapter = async (
    targetChapter: number,
    drafts: Record<number, string>,
    summary: string,
    characters: string,
    onProgress?: (message: string) => void
  ) => {
    const body = {
      ...buildChapterOptions(targetChapter, drafts, summary, characters),
      globalSummary: summary,
      characterState: characters,
      setting: setting.slice(0, 8000),
      topic,
      voiceCard: voiceCard || undefined,
      humanizeStrength,
      stages: { consistency: true, finalize: true, qualityRepair: true },
    }

    const res = await fetch(`${API}/chapter/pipeline?stream=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const reader = res.body?.getReader()
    if (!reader) {
      const data = await parseJsonResponse<PipelineResponse>(res)
      if (!data.ok) throw new Error(data.error || `第${targetChapter}章 pipeline 失败`)
      if (data.messages?.length) onConversation?.(data.messages)
      return data
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let result: PipelineResponse | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        try {
          const event = JSON.parse(line.slice(6)) as Record<string, unknown>
          if (typeof event.message === 'string') onProgress?.(event.message)
          if (event.type === 'result') result = event as PipelineResponse
          if (event.type === 'error') throw new Error(String(event.error || 'pipeline 失败'))
        } catch (e) {
          if (e instanceof Error && e.message !== 'pipeline 失败') throw e
        }
      }
    }

    if (!result?.ok) throw new Error(result?.error || `第${targetChapter}章 pipeline 失败`)
    if (result.messages?.length) onConversation?.(result.messages)
    return result
  }

  const persistChapter = async (
    targetChapter: number,
    chapterText: string,
    summary: string,
    characters: string
  ) => {
    setGlobalSummary(summary)
    setCharacterState(characters)
    setLastGeneratedChapter(targetChapter)
    setDraftedChapters((prev) => ({ ...prev, [targetChapter]: chapterText }))

    const query = currentBookId ? `?bookId=${encodeURIComponent(currentBookId)}` : ''
    const res = await fetch(`${API}/project/chapter${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterNumber: targetChapter,
        content: chapterText,
        globalSummary: summary,
        characterState: characters,
        lastGeneratedChapter: targetChapter,
      }),
    })
    const data = await parseJsonResponse<{ ok: boolean; error?: string }>(res)
    if (!data.ok) throw new Error(data.error || '章节保存失败')
  }

  const generate = async () => {
    setLoading(true)
    setError('')
    setFormatNotice('')
    setConsistencyResult('')
    setAutoStatus('')
    try {
      const piped = await runPipelineChapter(chapterNumber, draftedChapters, globalSummary, characterState, (msg) => {
        setAutoStatus(`第${chapterNumber}章：${msg}`)
      })
      const text = piped.content || ''
      if (piped.quality?.shortChapter) {
        const nextDrafts = { ...draftedChapters, [chapterNumber]: text }
        setContent(text)
        setDraftedChapters(nextDrafts)
        setLastGeneratedChapter(chapterNumber)
        setFormatNotice(formatQualityNotice(piped.quality))
        await persistChapter(chapterNumber, text, globalSummary, characterState)
        throw new Error(`第${chapterNumber}章字数不足，已保存草稿：${formatQualityIssues(piped.quality)}`)
      }
      const nextSummary = piped.summary || globalSummary
      const nextCharacters = piped.characterState || characterState
      setContent(text)
      if (piped.consistencyReview) setConsistencyResult(piped.consistencyReview)
      setFormatNotice(formatQualityNotice(piped.quality))
      await persistChapter(chapterNumber, text, nextSummary, nextCharacters)
      setAutoStatus(`第${chapterNumber}章完成：生成→一致性→定稿 已自动完成`)
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  const checkConsistency = async () => {
    const text = content || draftedChapters[chapterNumber]
    if (!text) return
    setLoading(true)
    setConsistencyResult('')
    setError('')
    try {
      const result = await checkOneChapter(text, globalSummary, characterState)
      setConsistencyResult(result)
    } catch (e) {
      setError((e as Error).message || '一致性校验失败')
    } finally {
      setLoading(false)
    }
  }

  const repairCurrentConsistency = async () => {
    const text = content || draftedChapters[chapterNumber]
    if (!text) return
    setLoading(true)
    setError('')
    try {
      const result = await repairOneChapterConsistency(text, globalSummary, characterState, consistencyResult)
      setConsistencyResult(formatConsistencyRepairNotice(result))
      if (result.changed && result.content) {
        const nextDrafts = { ...draftedChapters, [chapterNumber]: result.content }
        setContent(result.content)
        setDraftedChapters(nextDrafts)
        setFormatNotice(formatQualityNotice(result.quality) || '已按一致性审校自动修稿。')
        await onSave({ draftedChapters: nextDrafts })
      } else {
        setFormatNotice('一致性审校未发现需要修稿的问题。')
      }
    } catch (e) {
      setError((e as Error).message || '一致性修稿失败')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrentChapter = async () => {
    const text = content || draftedChapters[chapterNumber]
    if (!text) return
    setLoading(true)
    setFormatNotice('')
    setError('')
    try {
      const data = await formatOneChapter(text)
      const nextDrafts = { ...draftedChapters, [chapterNumber]: data.content || text }
      setContent(data.content || text)
      setDraftedChapters(nextDrafts)
      setFormatNotice(formatQualityNotice(data.quality) || '已整理格式。')
      await onSave({ draftedChapters: nextDrafts })
    } catch (e) {
      setError((e as Error).message || '格式整理失败')
    } finally {
      setLoading(false)
    }
  }

  const runAutoPipeline = async () => {
    if (!parsedChapters.length || autoRunning) return
    let workingDrafts = { ...draftedChapters }
    let workingSummary = globalSummary
    let workingCharacters = characterState
    let lastProcessed = chapterNumber - 1

    stopAutoRef.current = false
    setStopAuto(false)
    setAutoRunning(true)
    setLoading(true)
    setError('')
    setFormatNotice('')
    setConsistencyResult('')

    try {
      for (let n = chapterNumber; n <= maxChapter; n += 1) {
        if (stopAutoRef.current) break
        setChapterNumber(n)
        setContent(workingDrafts[n] || '')

        setAutoStatus(`第${n}章：pipeline 执行中…`)
        const piped = await runPipelineChapter(n, workingDrafts, workingSummary, workingCharacters, (msg) => {
          setAutoStatus(`第${n}章：${msg}`)
        })
        let chapterText = piped.content || ''

        if (piped.quality?.shortChapter) {
          workingDrafts = { ...workingDrafts, [n]: chapterText }
          setContent(chapterText)
          setDraftedChapters(workingDrafts)
          setFormatNotice(formatQualityNotice(piped.quality))
          await persistChapter(n, chapterText, workingSummary, workingCharacters)
          throw new Error(`第${n}章字数不足，已保存草稿并暂停自动连写：${formatQualityIssues(piped.quality)}`)
        }

        if (piped.consistencyReview) {
          setConsistencyResult(piped.consistencyReview)
        }

        workingSummary = piped.summary || workingSummary
        workingCharacters = piped.characterState || workingCharacters
        workingDrafts = { ...workingDrafts, [n]: chapterText }
        setContent(chapterText)
        setDraftedChapters(workingDrafts)
        setFormatNotice(formatQualityNotice(piped.quality))
        lastProcessed = n

        setAutoStatus(`第${n}章：保存中…`)
        await persistChapter(n, chapterText, workingSummary, workingCharacters)
      }

      const targetChapter = lastProcessed > 0 ? Math.min(maxChapter, lastProcessed + 1) : chapterNumber
      setChapterNumber(targetChapter)
      setContent(workingDrafts[targetChapter] || '')
      setFormatNotice(stopAutoRef.current ? '自动连写已停止，已保存完成的章节。' : '自动连写完成，已逐章定稿并保存。')
    } catch (e) {
      setError((e as Error).message || '自动连写失败')
      setFormatNotice(lastProcessed > 0 ? `已保存到第${lastProcessed}章。` : '')
    } finally {
      setAutoStatus('')
      setAutoRunning(false)
      setStopAuto(false)
      stopAutoRef.current = false
      setLoading(false)
    }
  }

  const requestStopAutoPipeline = () => {
    stopAutoRef.current = true
    setStopAuto(true)
    setAutoStatus('收到停止指令，当前章节处理完会停下并保存。')
  }

  const selectChapter = (nextChapter: number) => {
    setChapterNumber(nextChapter)
    setContent(draftedChapters[nextChapter] || '')
    setError('')
    setFormatNotice('')
  }

  return (
    <div>
      <h2>Step3 写草稿</h2>
      <p className="muted">选择章节后生成正文；也可以自动连写：生成下一章、一致性校验、Step4 定稿回写，然后继续下一章。已启用主角口吻卡与番茄追读润稿。</p>

      {voiceCard && (
        <details className="form-row" style={{ marginBottom: '0.75rem' }}>
          <summary className="label" style={{ cursor: 'pointer' }}>主角口吻卡（已启用，写章时自动注入）</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.5rem' }}>{voiceCard}</pre>
        </details>
      )}

      <div className="form-row">
        <label className="label">选择章节</label>
        <select className="input" value={chapterNumber} onChange={(e) => selectChapter(Number(e.target.value))}>
          {parsedChapters.map((chapter) => (
            <option key={chapter.number} value={chapter.number}>
              第{chapter.number}章 - {chapter.title}
            </option>
          ))}
        </select>
        {displayContent && <span className="muted" style={{ marginLeft: '0.5rem' }}>约 {wordCount} 字</span>}
      </div>

      {chapterInfo && (
        <div className="form-row" style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
          <span>定位：{chapterInfo.role}</span>
          <span style={{ marginLeft: '1rem' }}>作用：{chapterInfo.purpose}</span>
          <span style={{ marginLeft: '1rem' }}>简述：{chapterInfo.summary}</span>
        </div>
      )}

      <div className="form-row">
        <label className="label">本章指导（可选）</label>
        <input
          className="input"
          value={userGuidance}
          onChange={(e) => setUserGuidance(e.target.value)}
          placeholder="对本章剧情、语气、节奏的额外要求"
        />
      </div>

      {directorOutline && (
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                if (!chapterInfo) return
                setOutlineLoading(true)
                setError('')
                try {
                  const res = await fetch(`${API}/outline/chapter`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      directorOutline: directorOutline.slice(0, 6000),
                      novelSetting: setting.slice(0, 3000),
                      chapterNumber,
                      title: chapterInfo.title,
                      chapterRole: chapterInfo.role,
                      chapterPurpose: chapterInfo.purpose,
                      chapterSummary: chapterInfo.summary,
                      volumeIndex: Math.ceil(chapterNumber / 50),
                    }),
                  })
                  const data = await parseJsonResponse<{ ok: boolean; outline?: string; error?: string; messages?: { role: string; content: string }[] }>(res)
                  if (!data.ok) throw new Error(data.error || '细纲生成失败')
                  if (data.messages?.length) onConversation?.(data.messages)
                  setChapterOutline(data.outline || '')
                } catch (e) {
                  setError((e as Error).message || '请求失败')
                } finally {
                  setOutlineLoading(false)
                }
              }}
              disabled={outlineLoading}
            >
              {outlineLoading ? '细纲生成中…' : chapterOutline ? '重新生成本章细纲' : '🎬 生成本章细纲'}
            </button>
            {chapterOutline && (
              <button
                type="button"
                className="btn"
                onClick={() => setChapterOutline('')}
                title="写章时不使用细纲"
              >
                不使用细纲
              </button>
            )}
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              细纲将注入写章 prompt：目标/开场钩/三段推进/爽点/章尾钩/伏笔/人设细节
            </span>
          </div>
          {chapterOutline && (
            <textarea
              className="textarea"
              value={chapterOutline}
              onChange={(e) => setChapterOutline(e.target.value)}
              rows={10}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', width: '100%' }}
            />
          )}
        </div>
      )}

      <div className="form-row">
        <label className="label">去 AI 味强度</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={humanizeStrength}
          onChange={(e) => setHumanizeStrength(Number(e.target.value))}
        />
        <span style={{ marginLeft: '0.5rem' }}>{humanizeStrength}</span>
        <span className="muted" style={{ marginLeft: '0.75rem' }}>推荐 0.5–0.65，过高可能改词过假</span>
      </div>

      <div className="form-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={autoConsistency} onChange={(e) => setAutoConsistency(e.target.checked)} />
          <span>生成后自动一致性校验</span>
        </label>
      </div>

      <div className="form-row">
        <button className="btn primary" onClick={generate} disabled={loading || autoRunning}>
          {loading && !autoRunning ? '生成中...' : '生成本章'}
        </button>
        <button type="button" className="btn primary" onClick={runAutoPipeline} disabled={loading || autoRunning || !parsedChapters.length} style={{ marginLeft: '0.5rem' }}>
          自动连写到末章
        </button>
        {autoRunning && (
          <button type="button" className="btn danger" onClick={requestStopAutoPipeline} disabled={stopAuto} style={{ marginLeft: '0.5rem' }}>
            {stopAuto ? '停止中...' : '停止自动'}
          </button>
        )}
        {displayContent && (
          <button type="button" className="btn" onClick={checkConsistency} disabled={loading || autoRunning} style={{ marginLeft: '0.5rem' }}>
            一致性审校
          </button>
        )}
        {displayContent && (
          <button type="button" className="btn" onClick={repairCurrentConsistency} disabled={loading || autoRunning} style={{ marginLeft: '0.5rem' }}>
            按审校修稿
          </button>
        )}
        {displayContent && (
          <button type="button" className="btn" onClick={formatCurrentChapter} disabled={loading || autoRunning} style={{ marginLeft: '0.5rem' }}>
            整理格式
          </button>
        )}
        <button type="button" className="btn" onClick={() => onFinalize(chapterNumber)} disabled={autoRunning} style={{ marginLeft: '0.5rem' }}>
          去 Step4 定稿
        </button>
        <button type="button" className="btn" onClick={() => onSave()} disabled={autoRunning} style={{ marginLeft: '0.5rem' }}>
          保存
        </button>
        {error && <span className="error" style={{ marginLeft: '0.75rem' }}>{error}</span>}
        {formatNotice && <span className="success" style={{ marginLeft: '0.75rem' }}>{formatNotice}</span>}
        {autoStatus && <span className="muted" style={{ marginLeft: '0.75rem' }}>{autoStatus}</span>}
      </div>

      {consistencyResult && (
        <div className="form-row" style={{ background: 'var(--bg)', padding: '0.75rem', borderRadius: 'var(--radius)' }}>
          <label className="label">审校结果</label>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{consistencyResult}</pre>
        </div>
      )}

      {displayContent && (
        <div className="form-row">
          <label className="label">正文</label>
          <textarea
            className="textarea"
            value={displayContent}
            onChange={(e) => {
              setContent(e.target.value)
              setDraftedChapters({ ...draftedChapters, [chapterNumber]: e.target.value })
            }}
            rows={18}
            style={{ fontFamily: 'var(--font-serif)' }}
          />
          <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(displayContent)}>
            复制
          </button>
        </div>
      )}
    </div>
  )
}
