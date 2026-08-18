import { useEffect, useMemo, useState } from 'react'
import type { ProjectSaveOverrides } from '../App'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Props = {
  draftedChapters: Record<number, string>
  globalSummary: string
  setGlobalSummary: (v: string) => void
  characterState: string
  setCharacterState: (v: string) => void
  setting: string
  selectedChapter: number
  setSelectedChapter: (v: number) => void
  onSave: (overrides?: ProjectSaveOverrides) => void
}

export function Step4Finalize({
  draftedChapters,
  globalSummary,
  setGlobalSummary,
  characterState,
  setCharacterState,
  setting,
  selectedChapter,
  setSelectedChapter,
  onSave,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const chapterNumbers = useMemo(
    () => Object.keys(draftedChapters).map(Number).sort((a, b) => a - b),
    [draftedChapters]
  )
  const content = draftedChapters[selectedChapter] || ''
  const wordCount = content.replace(/\s/g, '').length

  useEffect(() => {
    if (!chapterNumbers.length) return
    if (!chapterNumbers.includes(selectedChapter)) {
      setSelectedChapter(chapterNumbers[chapterNumbers.length - 1])
    }
  }, [chapterNumbers, selectedChapter, setSelectedChapter])

  const finalize = async () => {
    if (!content.trim()) {
      setError('请选择已有正文的章节再定稿')
      return
    }
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const [summaryRes, stateRes] = await Promise.all([
        fetch(`${API}/step4-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterText: content, currentSummary: globalSummary }),
        }),
        fetch(`${API}/step4-character-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chapterText: content,
            oldCharacterState: characterState,
            initialCharacterDynamics: setting.slice(0, 2000),
          }),
        }),
      ])
      const summaryData = await parseJsonResponse<{ ok: boolean; summary?: string }>(summaryRes)
      const stateData = await parseJsonResponse<{ ok: boolean; characterState?: string }>(stateRes)
      const nextGlobalSummary = summaryData.ok && summaryData.summary ? summaryData.summary : globalSummary
      const nextCharacterState = stateData.ok && stateData.characterState ? stateData.characterState : characterState
      setGlobalSummary(nextGlobalSummary)
      setCharacterState(nextCharacterState)
      setMessage('定稿完成：前文摘要与角色状态已更新')
      onSave({ globalSummary: nextGlobalSummary, characterState: nextCharacterState })
    } catch (e) {
      setError((e as Error).message || '定稿失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Step4 定稿</h2>
      <p className="muted">将本章纳入前文摘要与角色状态，便于后续章节衔接</p>
      <div className="form-row">
        <label className="label">选择要定稿的章节</label>
        <select
          className="input"
          value={selectedChapter}
          onChange={(e) => setSelectedChapter(Number(e.target.value))}
        >
          {chapterNumbers.length
            ? chapterNumbers.map((n) => (
                <option key={n} value={n}>
                  第{n}章
                </option>
              ))
            : [<option key={1} value={1}>第1章（暂无草稿）</option>]}
        </select>
      </div>
      <div className="form-row">
        <button className="btn primary" onClick={finalize} disabled={loading || !content.trim()}>
          {loading ? '处理中…' : '定稿本章'}
        </button>
        <button type="button" className="btn" onClick={() => onSave()} style={{ marginLeft: '0.5rem' }}>保存</button>
        {!content.trim() && (
          <span className="muted" style={{ marginLeft: '0.75rem' }}>
            当前章节没有正文，请先在 Step3 生成或选择已有正文的章节
          </span>
        )}
        {message && <span className="success" style={{ marginLeft: '0.75rem' }}>{message}</span>}
        {error && <span className="error" style={{ marginLeft: '0.75rem' }}>{error}</span>}
      </div>
      <div className="form-row">
        <label className="label">本章正文预览{content.trim() ? `（约 ${wordCount} 字）` : ''}</label>
        <textarea
          className="textarea"
          value={content}
          readOnly
          rows={10}
          placeholder="这里会显示待定稿章节的正文。为空时，定稿不会执行。"
          style={{ fontFamily: 'var(--font-serif)' }}
        />
      </div>
      <div className="form-row">
        <label className="label">前文摘要（定稿后更新）</label>
        <textarea
          className="textarea"
          value={globalSummary}
          onChange={(e) => setGlobalSummary(e.target.value)}
          rows={6}
          placeholder="定稿后由系统更新，也可手动编辑"
        />
      </div>
      <div className="form-row">
        <label className="label">角色状态（定稿后更新）</label>
        <textarea
          className="textarea"
          value={characterState}
          onChange={(e) => setCharacterState(e.target.value)}
          rows={8}
          placeholder="定稿后由系统更新，也可手动编辑"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
        />
      </div>
    </div>
  )
}
