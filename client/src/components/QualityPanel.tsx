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

  // AI 味逐句定位
  const [aiIndex, setAiIndex] = useState<{ index: number; level: string; problemCount: number; sentenceCount: number; sentences: { text: string; score: number; reasons: string[] }[] } | null>(null)
  const [aiChapter, setAiChapter] = useState(1)
  const [aiLoading, setAiLoading] = useState(false)
  const runAiIndex = async () => {
    setAiLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/book/ai-index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, chapterNumber: aiChapter }),
      })
      const d = await parseJsonResponse(res)
      if (!d.ok) throw new Error(d.error || '定位失败')
      setAiIndex(d)
    } catch (e) {
      setError((e as Error).message || '定位失败')
    } finally {
      setAiLoading(false)
    }
  }

  // 商业化三件套
  const [pack, setPack] = useState<any | null>(null)
  const [packLoading, setPackLoading] = useState(false)
  const runPack = async () => {
    setPackLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/book/commercial-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      })
      const d = await parseJsonResponse(res)
      if (!d.ok) throw new Error(d.error || '生成失败')
      setPack(d.pack)
    } catch (e) {
      setError((e as Error).message || '生成失败')
    } finally {
      setPackLoading(false)
    }
  }

  // 番茄数据看板
  const [fanqie, setFanqie] = useState<any | null>(null)
  const [fanqieLoading, setFanqieLoading] = useState(false)
  const loadFanqie = async () => {
    setFanqieLoading(true)
    try {
      const res = await fetch(`${API}/book/fanqie-data`)
      const d = await parseJsonResponse(res)
      setFanqie(d)
    } catch { /* ignore */ } finally {
      setFanqieLoading(false)
    }
  }
  const refreshFanqie = async () => {
    setFanqieLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/book/fanqie-data/refresh`, { method: 'POST' })
      const d = await parseJsonResponse(res)
      if (!d.ok) setError(d.error || '刷新失败')
      setFanqie(d)
    } catch (e) {
      setError((e as Error).message || '刷新失败')
    } finally {
      setFanqieLoading(false)
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
        <button className="btn" onClick={runPack} disabled={packLoading || !bookId}>
          {packLoading ? '生成中…' : '📦 商业化三件套'}
        </button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          番茄分 ≥8.5 优秀 / 8.2-8.5 良好 / 7.8-8.2 需关注 / &lt;7.8 建议重写
        </span>
      </div>

      {/* 去 AI 味定位 */}
      <div className="form-row" style={{ marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <label className="label" style={{ marginRight: '0.5rem' }}>🔍 去 AI 味定位（第</label>
        <input className="input" type="number" min={1} value={aiChapter} onChange={(e) => setAiChapter(Number(e.target.value))} style={{ width: 70 }} />
        <label className="label" style={{ margin: '0 0.5rem 0 0.25rem' }}>章）</label>
        <button className="btn" onClick={runAiIndex} disabled={aiLoading || !bookId}>
          {aiLoading ? '分析中…' : '定位 AI 味句子'}
        </button>
        {aiIndex && (
          <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem', color: aiIndex.index >= 8.5 ? '#4caf50' : aiIndex.index >= 7 ? '#f5a623' : '#c3272b' }}>
            去 AI 味指数 {aiIndex.index}/10（{aiIndex.level}）· 问题句 {aiIndex.problemCount}/{aiIndex.sentenceCount}
          </span>
        )}
      </div>
      {aiIndex && aiIndex.sentences.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: 'auto', margin: '0.5rem 0', fontSize: '0.82rem' }}>
          {aiIndex.sentences.map((s, i) => (
            <div key={i} style={{ padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: s.score >= 3 ? '#c3272b' : '#f5a623', fontWeight: 600 }}>[{s.score}]</span>{' '}
              {s.text.slice(0, 80)}
              {s.text.length > 80 ? '…' : ''}
              <span className="muted" style={{ marginLeft: '0.5rem' }}>{s.reasons.join('、')}</span>
            </div>
          ))}
        </div>
      )}

      {/* 商业化三件套 */}
      {pack && (
        <div style={{ margin: '0.75rem 0', padding: '0.75rem 1rem', borderRadius: 8, border: '1px solid var(--border, #333)' }}>
          <h3 style={{ margin: '0 0 0.5rem' }}>📦 商业化三件套</h3>
          <div style={{ fontSize: '0.9rem' }}>
            <strong>书名候选：</strong>
            {(pack.titles || []).map((t: any, i: number) => (
              <div key={i} style={{ margin: '0.2rem 0' }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.82rem' }}>{t.reason}</span>
              </div>
            ))}
            {pack.recommendedTitle && <p style={{ margin: '0.4rem 0' }}>✅ 推荐：{pack.recommendedTitle}</p>}
            <strong style={{ display: 'block', marginTop: '0.5rem' }}>简介：</strong>
            {(pack.intros || []).map((it: any, i: number) => (
              <div key={i} style={{ margin: '0.3rem 0', fontSize: '0.85rem' }}>
                <strong>{it.version}：</strong>{it.text}
              </div>
            ))}
            <strong style={{ display: 'block', marginTop: '0.5rem' }}>标签：</strong>
            <span>{(pack.tags || []).map((t: string) => `#${t}`).join(' ')}</span>
            {pack.marketingAngle && <p style={{ margin: '0.4rem 0', fontSize: '0.85rem' }}>营销角度：{pack.marketingAngle}</p>}
          </div>
        </div>
      )}

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

      {/* 番茄数据看板 */}
      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border, #333)', paddingTop: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>📈 番茄数据看板</h3>
          <button className="btn" onClick={loadFanqie} disabled={fanqieLoading}>加载缓存</button>
          <button className="btn primary" onClick={refreshFanqie} disabled={fanqieLoading}>
            {fanqieLoading ? '抓取中…' : '🔄 刷新数据'}
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            登录状态：{fanqie?.loggedIn ? '✅ 已登录' : fanqie ? '❌ 未登录（请在 Step5 点「登录番茄」重新登录）' : '—'}
          </span>
        </div>
        {fanqie?.cached?.loginValid === false && (
          <p className="error" style={{ fontSize: '0.85rem' }}>
            番茄登录态已过期，数据抓取需要重新登录：Step5 →「登录番茄」→ 浏览器扫码登录后回来刷新。
          </p>
        )}
        {fanqie?.cached?.books && fanqie.cached.books.length > 0 && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.88rem' }}>
            {fanqie.cached.books.map((b: any, i: number) => (
              <div key={i} style={{ padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <strong>《{b.title}》</strong>
                <span className="muted" style={{ marginLeft: '0.75rem' }}>{b.numbers.join(' ')}</span>
              </div>
            ))}
            <p className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
              抓取时间：{fanqie.cached.fetchedAt?.slice(0, 16).replace('T', ' ')}
            </p>
          </div>
        )}
        {fanqie?.cached?.books?.length === 0 && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            暂无缓存数据（登录后刷新即可抓取阅读/在读/完读/追读数据）。
          </p>
        )}
      </div>
    </div>
  )
}
