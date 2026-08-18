import { useState } from 'react'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Props = {
  topic: string
  setTopic: (v: string) => void
  genre: string
  setGenre: (v: string) => void
  wordPerChapter: number
  setWordPerChapter: (n: number) => void
  setting: string
  setSetting: (v: string) => void
  voiceCard: string
  setVoiceCard: (v: string) => void
  numChapters: number
  setNumChapters: (n: number) => void
  onGenerated: () => void
  onSave: () => void
  onConversation?: (messages: { role: string; content: string }[]) => void
}

export function Step1Setting({
  topic,
  setTopic,
  genre,
  setGenre,
  wordPerChapter,
  setWordPerChapter,
  setting,
  setSetting,
  voiceCard,
  setVoiceCard,
  numChapters,
  setNumChapters,
  onGenerated,
  onSave,
  onConversation,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadLinZhaoVoiceCard = async () => {
    try {
      const res = await fetch(`${API}/voice-card/presets`)
      const data = await parseJsonResponse<{ ok: boolean; presets?: { linzhao?: string } }>(res)
      if (data.presets?.linzhao) {
        setVoiceCard(data.presets.linzhao)
      }
    } catch {
      setError('加载口吻卡失败')
    }
  }

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/step1-setting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, genre, numChapters, wordPerChapter }),
      })
      const data = await parseJsonResponse<{ ok: boolean; setting?: string; error?: string; messages?: { role: string; content: string }[] }>(res)
      if (data.ok && data.setting) {
        setSetting(data.setting)
        if (data.messages?.length) onConversation?.(data.messages)
        onGenerated()
        onSave()
      } else {
        setError(data.error || '生成失败')
      }
    } catch (e) {
      setError((e as Error).message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Step1 生成设定</h2>
      <p className="muted">核心种子 + 角色 + 世界观 + 情节架构（雪花法）</p>
      <div className="form-row">
        <label className="label">主题/点子</label>
        <textarea
          className="textarea"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="一句话或几句话描述故事核心"
          rows={2}
        />
      </div>
      <div className="form-row">
        <label className="label">类型</label>
        <input
          className="input"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="都市 / 玄幻 / 言情 / 悬疑"
        />
      </div>
      <div className="form-row">
        <label className="label">章节数（支持几百～几千章，几百万字）</label>
        <input
          className="input"
          type="number"
          min={5}
          max={5000}
          value={numChapters}
          onChange={(e) => setNumChapters(Math.min(5000, Math.max(5, Number(e.target.value) || 20)))}
        />
        <span className="muted" style={{ marginLeft: '0.5rem' }}>
          约 {(numChapters * wordPerChapter) / 10000} 万字
        </span>
      </div>
      <div className="form-row">
        <label className="label">每章字数</label>
        <input
          className="input"
          type="number"
          min={500}
          value={wordPerChapter}
          onChange={(e) => setWordPerChapter(Number(e.target.value) || 2000)}
        />
      </div>
      <div className="form-row">
        <button className="btn primary" onClick={generate} disabled={loading}>
          {loading ? '生成中…' : '生成设定'}
        </button>
        <button type="button" className="btn" onClick={onSave} style={{ marginLeft: '0.5rem' }}>保存</button>
        {error && <span className="error" style={{ marginLeft: '0.75rem' }}>{error}</span>}
      </div>
      {setting && (
        <div className="form-row">
          <label className="label">设定内容（可编辑）</label>
          <textarea
            className="textarea"
            value={setting}
            onChange={(e) => setSetting(e.target.value)}
            rows={14}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}
          />
        </div>
      )}
      <div className="form-row">
        <label className="label">主角口吻卡（写章/润稿自动注入，强化人味）</label>
        <textarea
          className="textarea"
          value={voiceCard}
          onChange={(e) => setVoiceCard(e.target.value)}
          placeholder="例如：林照说话懒、短句、爱吐槽…（可在 Step1 点「填入林照默认口吻卡」）"
          rows={8}
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
        />
      </div>
      <div className="form-row">
        <button type="button" className="btn" onClick={loadLinZhaoVoiceCard}>
          填入林照默认口吻卡
        </button>
        <button type="button" className="btn" onClick={onSave} style={{ marginLeft: '0.5rem' }}>
          保存口吻卡
        </button>
      </div>
    </div>
  )
}
