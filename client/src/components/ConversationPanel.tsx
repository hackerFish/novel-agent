import { useState } from 'react'

export type ConversationMessage = { role: string; content: string }

const MAX_PREVIEW = 400

type Props = {
  open: boolean
  onClose: () => void
  messages: ConversationMessage[]
  onClear: () => void
}

export function ConversationPanel({ open, onClose, messages, onClear }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  if (!open) return null

  return (
    <>
      <div className="conversation-overlay" onClick={onClose} aria-hidden />
      <aside className="conversation-panel">
        <div className="conversation-header">
          <h3>与 AI 对答</h3>
          <button type="button" className="btn-icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="conversation-actions">
          <button type="button" className="btn" onClick={onClear}>
            清空记录
          </button>
        </div>
        <div className="conversation-list">
          {messages.length === 0 && (
            <p className="muted">暂无记录，生成设定/目录/章节后会在此展示与 AI 的完整对答。</p>
          )}
          {messages.map((m, i) => {
            const id = i
            const isLong = m.content.length > MAX_PREVIEW
            const showFull = expandedId === id
            const text = showFull ? m.content : (isLong ? m.content.slice(0, MAX_PREVIEW) + '…' : m.content)
            return (
              <div key={id} className={`conversation-item conversation-item--${m.role}`}>
                <span className="conversation-role">{m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : m.role}</span>
                <pre className="conversation-content">{text}</pre>
                {isLong && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => setExpandedId(showFull ? null : id)}
                  >
                    {showFull ? '收起' : '展开'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
