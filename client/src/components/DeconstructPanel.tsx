import { useState } from 'react'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Deconstruction = {
  book: string
  genre: string
  coreSellingPoint: string
  structure?: { act1?: string; act2?: string; act3?: string }
  hookRhythm?: string
  characterSystem?: string[]
  worldSetting?: string
  writingTechniques?: Record<string, string>
  reusablePatterns?: string[]
  reusablePrompts?: string[]
  whatToAvoid?: string[]
}

/** 拆书分析：爆款逆向 → 写法库 */
export function DeconstructPanel() {
  const [book, setBook] = useState('')
  const [intro, setIntro] = useState('')
  const [sampleText, setSampleText] = useState('')
  const [result, setResult] = useState<Deconstruction | null>(null)
  const [patterns, setPatterns] = useState<Deconstruction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadPatterns = async () => {
    try {
      const res = await fetch(`${API}/patterns`)
      const data = await parseJsonResponse<{ ok: boolean; patterns: Deconstruction[] }>(res)
      setPatterns(data.patterns || [])
    } catch { /* ignore */ }
  }

  const run = async () => {
    if (!book.trim()) { setError('请输入书名'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/deconstruct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book: book.trim(), intro: intro.trim(), sampleText: sampleText.trim(), save: true }),
      })
      const data = await parseJsonResponse<{ ok: boolean; deconstruction?: Deconstruction; error?: string }>(res)
      if (!data.ok) throw new Error(data.error || '拆书失败')
      setResult(data.deconstruction || null)
      await loadPatterns()
    } catch (e) {
      setError((e as Error).message || '拆书失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>📖 拆书分析（爆款逆向 → 写法库）</h2>
        <button className="btn" onClick={loadPatterns}>刷新写法库</button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>已存 {patterns.length} 本爆款拆解</span>
      </div>

      <div className="form-row" style={{ marginTop: '0.75rem' }}>
        <label className="label">书名</label>
        <input className="input" value={book} onChange={(e) => setBook(e.target.value)} placeholder="如：十日终焉 / 罪名不朽 / 我，圈钱主播" />
      </div>
      <div className="form-row">
        <label className="label">简介（可选）</label>
        <textarea className="textarea" value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} placeholder="粘贴书籍简介，让拆解更精准" />
      </div>
      <div className="form-row">
        <label className="label">章节样本（可选）</label>
        <textarea className="textarea" value={sampleText} onChange={(e) => setSampleText(e.target.value)} rows={3} placeholder="粘贴任意章节正文，分析文风技法" />
      </div>
      <div className="form-row">
        <button className="btn primary" onClick={run} disabled={loading}>
          {loading ? '拆解中（约 30 秒）…' : '🔍 开始拆书'}
        </button>
        {error && <span className="error" style={{ marginLeft: '0.75rem' }}>{error}</span>}
      </div>

      {result && (
        <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>《{result.book}》拆解报告</h3>
          <p><strong>题材：</strong>{result.genre}</p>
          <p><strong>核心卖点：</strong>{result.coreSellingPoint}</p>
          {result.structure && (
            <>
              <p><strong>开局：</strong>{result.structure.act1}</p>
              <p><strong>发展：</strong>{result.structure.act2}</p>
              <p><strong>高潮：</strong>{result.structure.act3}</p>
            </>
          )}
          {result.hookRhythm && <p><strong>钩子节奏：</strong>{result.hookRhythm}</p>}
          {result.writingTechniques && (
            <div>
              <strong>写法技法：</strong>
              {Object.entries(result.writingTechniques).map(([k, v]) => (
                <p key={k} style={{ margin: '0.2rem 0' }}>· {k}：{v}</p>
              ))}
            </div>
          )}
          {result.reusablePatterns && result.reusablePatterns.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              <strong>🎯 可复用套路（已入写法库）：</strong>
              <ul style={{ margin: '0.3rem 0' }}>
                {result.reusablePatterns.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {patterns.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>📚 写法库（跨书可注入）</h3>
          {patterns.map((p) => (
            <details key={p.book} style={{ marginBottom: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>《{p.book}》 — {p.genre}</summary>
              <p style={{ margin: '0.4rem 0 0.2rem' }}>{p.coreSellingPoint}</p>
              {(p.reusablePatterns || []).map((pat, i) => (
                <p key={i} style={{ margin: '0.15rem 0', fontSize: '0.85rem' }}>· {pat}</p>
              ))}
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
