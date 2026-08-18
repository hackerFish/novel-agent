import { useState } from 'react'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type AuditChapter = {
  n: number
  chars: number
  score: number
  avgLen: number
  aiHits: string[]
  problems: string[]
}

type AuditSummary = {
  chapterCount: number
  totalChars: number
  avgScore: number
  dist: { good: number; ok: number; weak: number; bad: number }
  problemCount: number
  abilityCount: number
  foreshadowCount: number
  forgottenForeshadows: number
}

type AuditData = {
  ok: boolean
  error?: string
  summary?: AuditSummary
  problemChapters?: AuditChapter[]
}

type PromoRow = {
  n: number
  ok: boolean
  total: number
  max: number
  fixHints: string[]
}

type PromoData = {
  ok: boolean
  error?: string
  rows?: PromoRow[]
  summary?: { chapterCount: number; passed: number; failed: number; avgTotal: number; fullMark: boolean }
}

/** 品控看板：全书质量仪表盘（番茄分/AI味/伏笔/能力 + 推流验证分） */
export function QualityPanel({ bookId }: { bookId: string }) {
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [promo, setPromo] = useState<PromoData | null>(null)
  const [promoLoading, setPromoLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/book/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      const d = await parseJsonResponse<AuditData>(res)
      if (!d.ok) throw new Error(d.error || '审计失败')
      setData(d)
    } catch (e) {
      setError((e as Error).message || '审计失败')
    } finally {
      setLoading(false)
    }
  }

  const runPromo = async () => {
    setPromoLoading(true)
    try {
      const res = await fetch(`${API}/book/promotion-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      const d = await parseJsonResponse<PromoData>(res)
      setPromo(d)
    } catch (e) {
      setError((e as Error).message || '推流分获取失败')
    } finally {
      setPromoLoading(false)
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>🔍 品控看板</h2>
        <button className="btn primary" onClick={run} disabled={loading || !bookId}>
          {loading ? '审计中…' : data ? '重新审计' : '运行全书审计'}
        </button>
        <button className="btn" onClick={runPromo} disabled={promoLoading || !bookId}>
          {promoLoading ? '计算中…' : promo ? '重新计算' : '🎯 推流验证分'}
        </button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          番茄分 ≥8.5 优秀 / 8.2-8.5 良好 / 7.8-8.2 需关注 / &lt;7.8 建议重写
        </span>
      </div>

      {promo?.summary && (
        <div style={{ margin: '0.75rem 0', padding: '0.75rem 1rem', borderRadius: 8, border: `1px solid ${promo.summary.fullMark ? '#4caf5055' : '#f5a62355'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <strong style={{ color: promo.summary.fullMark ? '#4caf50' : '#f5a623' }}>
              {promo.summary.fullMark ? '🏆 全部章节推流验证满分，可发布' : `推流验证：通过 ${promo.summary.passed}/${promo.summary.chapterCount}，未过 ${promo.summary.failed} 章`}
            </strong>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              平均 {promo.summary.avgTotal}/60 分 · 满分 60 才可自动发布
            </span>
          </div>
          {promo.rows && promo.rows.filter((r) => !r.ok).length > 0 && (
            <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: '0.5rem', fontSize: '0.82rem' }}>
              {promo.rows.filter((r) => !r.ok).map((r) => (
                <div key={r.n} style={{ padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: '#f5a623' }}>第{r.n}章 {r.total}/{r.max}</span>
                  <span className="muted" style={{ marginLeft: '0.5rem' }}>{r.fixHints.slice(0, 3).join('；')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {data?.summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', margin: '1rem 0' }}>
            {[
              ['章节数', String(data.summary.chapterCount)],
              ['总字数(万)', (data.summary.totalChars / 10000).toFixed(1)],
              ['平均番茄分', data.summary.avgScore.toFixed(1)],
              ['问题章节', String(data.summary.problemCount)],
              ['能力数', String(data.summary.abilityCount)],
              ['在途伏笔', String(data.summary.foreshadowCount)],
              ['疑似遗忘伏笔', String(data.summary.forgottenForeshadows)],
            ].map(([k, v]) => (
              <div key={k} style={{ border: '1px solid var(--border, #333)', borderRadius: 8, padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{v}</div>
                <div className="muted" style={{ fontSize: '0.75rem' }}>{k}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            {[
              ['优秀', data.summary.dist.good, '#4caf50'],
              ['良好', data.summary.dist.ok, '#8bc34a'],
              ['需关注', data.summary.dist.weak, '#f5a623'],
              ['建议重写', data.summary.dist.bad, '#c3272b'],
            ].map(([label, count, color]) => (
              <span key={label as string} style={{ border: `1px solid ${color}55`, color, borderRadius: 12, padding: '0.15rem 0.6rem', fontSize: '0.8rem' }}>
                {label} {count} 章
              </span>
            ))}
          </div>

          {data.problemChapters && data.problemChapters.length > 0 && (
            <>
              <h3 style={{ margin: '0.75rem 0 0.5rem' }}>⚠️ 需关注章节（按分数升序）</h3>
              <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: '0.85rem' }}>
                {data.problemChapters.map((c) => (
                  <div key={c.n} style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ minWidth: 70 }}>第{c.n}章</span>
                    <span style={{ minWidth: 40, color: c.score < 8.2 ? '#c3272b' : '#f5a623' }}>{c.score}分</span>
                    <span className="muted" style={{ flex: 1 }}>
                      {c.problems.join('；') || '—'}
                      {c.aiHits.length ? ` | ${c.aiHits.join(' ')}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
