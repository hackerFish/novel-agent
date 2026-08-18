import { useState, useEffect } from 'react'
import { parseJsonResponse } from '../lib/api'

const API = '/api'

type Config = {
  provider: string
  ollamaBaseUrl: string
  ollamaModel: string
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  openaiModelAux: string
}

type OllamaStatus = { ok: boolean; models?: string[]; reason?: string }

export function ConfigPanel() {
  const [config, setConfig] = useState<Config>({
    provider: 'ollama',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:14b',
    openaiBaseUrl: 'https://api.deepseek.com/v1',
    openaiApiKey: '',
    openaiModel: 'deepseek-v4-pro',
    openaiModelAux: 'deepseek-v4-flash',
  })
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch(`${API}/config`)
      .then((r) => parseJsonResponse<Config>(r))
      .then(setConfig)
      .catch(() => {})
  }, [])

  const checkOllama = () => {
    setOllamaStatus(null)
    fetch(`${API}/config/ollama`)
      .then((r) => parseJsonResponse<OllamaStatus>(r))
      .then(setOllamaStatus)
      .catch(() => setOllamaStatus({ ok: false, reason: '请求失败' }))
  }

  const save = () => {
    setSaving(true)
    setMessage('')
    fetch(`${API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then((r) => parseJsonResponse(r))
      .then(() => {
        setMessage('配置已保存到本地，重启后仍会保留')
        if (config.provider === 'ollama') checkOllama()
      })
      .catch(() => setMessage('保存失败'))
      .finally(() => setSaving(false))
  }

  return (
    <div className="card">
      <h2>模型与 API</h2>
      <div className="form-row">
        <label className="label">推理后端</label>
        <select
          className="input"
          value={config.provider}
          onChange={(e) => setConfig({ ...config, provider: e.target.value })}
        >
          <option value="ollama">Ollama（本地，推荐）</option>
          <option value="openai">OpenAI 兼容 API</option>
        </select>
      </div>

      {config.provider === 'ollama' && (
        <>
          <div className="form-row">
            <label className="label">Ollama 地址</label>
            <input
              className="input"
              value={config.ollamaBaseUrl}
              onChange={(e) => setConfig({ ...config, ollamaBaseUrl: e.target.value })}
              placeholder="http://127.0.0.1:11434"
            />
          </div>
          <div className="form-row">
            <label className="label">模型名（建议 14b+ 降低 AI 味）</label>
            <input
              className="input"
              value={config.ollamaModel}
              onChange={(e) => setConfig({ ...config, ollamaModel: e.target.value })}
              placeholder="qwen2.5:14b"
            />
          </div>
          <div className="form-row">
            <button type="button" className="btn" onClick={checkOllama}>
              检测 Ollama
            </button>
            {ollamaStatus && (
              <span className={ollamaStatus.ok ? 'success' : 'error'} style={{ marginLeft: '0.75rem' }}>
                {ollamaStatus.ok
                  ? `已连接，模型: ${(ollamaStatus.models || []).join(', ') || '无'}`
                  : `未连接: ${ollamaStatus.reason || '未知'}`}
              </span>
            )}
          </div>
        </>
      )}

      {config.provider === 'openai' && (
        <>
          <div className="form-row">
            <label className="label">API 地址（可选，默认 OpenAI）</label>
            <input
              className="input"
              value={config.openaiBaseUrl}
              onChange={(e) => setConfig({ ...config, openaiBaseUrl: e.target.value })}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>
          <div className="form-row">
            <label className="label">API Key</label>
            <input
              className="input"
              type="password"
              value={config.openaiApiKey}
              onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div className="form-row">
            <label className="label">写章/正文模型（质量关键）</label>
            <input
              className="input"
              value={config.openaiModel}
              onChange={(e) => setConfig({ ...config, openaiModel: e.target.value })}
              placeholder="deepseek-v4-pro（高质量）/ deepseek-v4-flash（快速便宜）"
            />
          </div>
          <div className="form-row">
            <label className="label">辅助模型（审校/摘要/角色状态，省成本）</label>
            <input
              className="input"
              value={config.openaiModelAux}
              onChange={(e) => setConfig({ ...config, openaiModelAux: e.target.value })}
              placeholder="deepseek-v4-flash"
            />
          </div>
        </>
      )}

      <div className="form-row" style={{ marginTop: '1rem' }}>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存配置'}
        </button>
        {message && (
          <span className={message.includes('失败') ? 'error' : 'success'} style={{ marginLeft: '0.75rem' }}>
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
