import fetch from 'node-fetch';
import { getConfig } from '../config.js';
import { trimMessagesToBudget, OUTPUT_RESERVE_TOKENS } from './contextLimit.js';

const OPENAI_COMPAT_RETRY_LIMIT = 3;

/**
 * 统一 LLM 调用：支持 Ollama（本地）与 OpenAI 兼容 API。
 * 发送前按上下文预算截断，给输出预留空间，减少后文断裂和超上下文失败。
 * 模型路由：options.model = 'main'（默认，正文/目录等质量关键任务，用 openaiModel）
 *           options.model = 'aux'（审校/摘要/角色状态等辅助任务，用 openaiModelAux，省成本）
 *           options.model = 具体模型名（直接使用）
 */
export async function chat(messages, options = {}) {
  const cfg = getConfig();
  const { maxTokens = 4096, temperature = 0.82, model, thinking } = options;
  const cappedMaxTokens = Math.min(maxTokens, OUTPUT_RESERVE_TOKENS);
  const safeMessages = trimMessagesToBudget(Array.isArray(messages) ? messages : []);

  if (cfg.provider === 'ollama') {
    return ollamaChat(safeMessages, { ...options, maxTokens: cappedMaxTokens, temperature });
  }
  const modelName = model === 'aux' ? cfg.openaiModelAux : typeof model === 'string' && model ? model : cfg.openaiModel;
  return openaiChat(safeMessages, { ...options, maxTokens: cappedMaxTokens, temperature, model: modelName, thinking });
}

async function ollamaChat(messages, { maxTokens, temperature }) {
  const cfg = getConfig();
  const url = `${cfg.ollamaBaseUrl.replace(/\/$/, '')}/api/chat`;
  const body = {
    model: cfg.ollamaModel,
    messages,
    stream: false,
    options: {
      num_predict: maxTokens,
      temperature,
      top_p: 0.92,
      repeat_penalty: 1.15,
      frequency_penalty: 0.3,
    },
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e?.message || '';
    const code = e?.cause?.code ?? e?.code;
    if (code === 'ECONNREFUSED' || /ECONNREFUSED|connect.*refused/i.test(msg)) {
      throw new Error('Ollama 未启动。请先打开终端运行：ollama serve，或从开始菜单启动 Ollama。');
    }
    throw e;
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama 请求失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data?.message?.content ?? '';
  if (!content.trim()) {
    throw new Error('Ollama 返回内容为空，请检查模型是否正常运行。');
  }
  const userMsg = messages.find((m) => m.role === 'user');
  const exchange = [
    { role: 'user', content: userMsg?.content ?? '' },
    { role: 'assistant', content },
  ];
  return { content, usage: data.eval_count ? { total_tokens: data.eval_count } : {}, exchange };
}

async function openaiChat(messages, { maxTokens, temperature, model, thinking }) {
  const cfg = getConfig();
  const url = (cfg.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: model || cfg.openaiModel,
    messages,
    max_tokens: maxTokens,
    temperature,
    frequency_penalty: 0.35,
    presence_penalty: 0.2,
  };
  // aux 辅助任务默认禁用思考模式（更快更稳，避免审校输出推理过程）；
  // main 正文任务保持默认（DeepSeek V4 默认思考模式）。
  const useThinking = thinking === false || model === 'aux' ? { type: 'disabled' } : undefined;
  if (useThinking) body.thinking = useThinking;

  let lastError;
  let bodyWithThinking = JSON.parse(JSON.stringify(body));
  for (let attempt = 1; attempt <= OPENAI_COMPAT_RETRY_LIMIT; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: cfg.openaiApiKey ? `Bearer ${cfg.openaiApiKey}` : '',
        },
        body: JSON.stringify(bodyWithThinking),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 402 || /insufficient.?balance|余额不足/i.test(errText)) {
          throw new Error('账户余额不足，请到对应 API 平台（如 DeepSeek / OpenAI）充值后再试。');
        }
        // thinking 参数不被支持（非 DeepSeek 接口）：去掉后重试一次
        if (res.status === 400 && bodyWithThinking.thinking && !lastError?.__droppedThinking) {
          const e = new Error(errText);
          e.__droppedThinking = true;
          lastError = e;
          delete bodyWithThinking.thinking;
          await sleep(400);
          continue;
        }
        throw new Error(`OpenAI 兼容接口请求失败: ${res.status} ${errText}`);
      }

      const raw = await res.text();
      const data = parseJsonResponse(raw);
      const content = extractOpenAiContent(data);
      const userMsg = messages.find((m) => m.role === 'user');
      const exchange = [
        { role: 'user', content: userMsg?.content ?? '' },
        { role: 'assistant', content },
      ];
      return { content, usage: data.usage || {}, exchange };
    } catch (err) {
      lastError = err;
      if (!isRetryableLlmError(err) || attempt >= OPENAI_COMPAT_RETRY_LIMIT) {
        break;
      }
      await sleep(600 * attempt);
    }
  }

  throw new Error(`OpenAI 兼容接口返回异常，已重试 ${OPENAI_COMPAT_RETRY_LIMIT} 次仍失败：${lastError?.message || '未知错误'}`);
}

function parseJsonResponse(raw) {
  if (!raw || !raw.trim()) {
    throw new Error('接口返回空响应');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`接口返回不是有效 JSON：${raw.slice(0, 300)}`);
  }
}

function extractOpenAiContent(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('接口返回为空，未拿到 choices');
  }
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : data.error.message || JSON.stringify(data.error);
    throw new Error(`接口返回错误：${msg}`);
  }
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error(`接口返回缺少 choices：${JSON.stringify(data).slice(0, 300)}`);
  }
  const msg = data.choices[0]?.message;
  const content = msg?.content ?? data.choices[0]?.text ?? '';
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  // DeepSeek V4 等推理模型可能把输出放在 reasoning_content，content 为空
  const reasoning = msg?.reasoning_content ?? '';
  if (typeof reasoning === 'string' && reasoning.trim()) {
    return reasoning;
  }
  throw new Error(`接口返回内容为空：${JSON.stringify(data.choices[0]).slice(0, 300)}`);
}

function isRetryableLlmError(err) {
  const msg = err?.message || '';
  return /空响应|缺少 choices|内容为空|not valid JSON|不是有效 JSON|ECONNRESET|ETIMEDOUT|timeout|socket|network/i.test(msg);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 检测 Ollama 是否可用 */
export async function checkOllama() {
  const cfg = getConfig();
  if (cfg.provider !== 'ollama') return { ok: false, reason: 'not_ollama' };
  try {
    const r = await fetch(`${cfg.ollamaBaseUrl}/api/tags`, { method: 'GET' });
    if (!r.ok) return { ok: false, reason: 'ollama_not_running' };
    const d = await r.json();
    const models = (d.models || []).map((m) => m.name);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, reason: e.message || 'network_error' };
  }
}
