/**
 * 上下文长度控制（对齐 DeepSeek-V4：1M 上下文，输出最大 384K）
 * 写章场景保守使用 512K 输入预算，输出预留 8K
 */
const CONTEXT_MAX_TOKENS = 512000
const OUTPUT_RESERVE_TOKENS = 8192
/** 单次请求输入预算（tokens），留足余量避免触及上限 */
const INPUT_BUDGET_TOKENS = CONTEXT_MAX_TOKENS - OUTPUT_RESERVE_TOKENS - 2000
/** 按字符粗算：约 2 字符/token，用于截断时上限 */
const CHARS_PER_TOKEN = 2
const INPUT_BUDGET_CHARS = Math.floor(INPUT_BUDGET_TOKENS * CHARS_PER_TOKEN)

/**
 * 在不超过上限的前提下截断字符串，尽量在行或句末截断，保证连贯
 * @param {string} str - 原字符串
 * @param {number} maxChars - 最大字符数
 * @param {{ fromEnd?: boolean }} opts - fromEnd: true 时保留开头（从末尾截），false 时保留末尾（从开头截）
 * @returns {string}
 */
function trimToCharLimit(str, maxChars, opts = {}) {
  if (!str || typeof str !== 'string') return ''
  const fromEnd = opts.fromEnd !== false
  if (str.length <= maxChars) return str
  const s = fromEnd ? str.slice(0, maxChars) : str.slice(-maxChars)
  // 在行末或句末截断，避免截断到一半
  const breakPoints = fromEnd ? [...s.matchAll(/\n|。|！|？|\.\s/g)].map((m) => m.index + m[0].length) : []
  if (fromEnd) {
    const lastBreak = breakPoints.filter((i) => i <= maxChars).pop()
    if (lastBreak != null && lastBreak > maxChars * 0.7) return str.slice(0, lastBreak).trimEnd()
    return s.trimEnd()
  }
  const firstBreak = s.search(/\n|。|！|？|\.\s/)
  if (firstBreak !== -1 && firstBreak < maxChars * 0.3) return str.slice(str.length - maxChars + firstBreak + 1).trimStart()
  return s.trimStart()
}

/**
 * 估算消息列表总字符数（用于请求前校验）
 * @param {Array<{ role: string; content?: string }>} messages
 * @returns {number}
 */
function totalMessageChars(messages) {
  if (!Array.isArray(messages)) return 0
  return messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0)
}

/**
 * 若消息总长度超过预算，从最后一条 user 内容的末尾安全截断（保留指令、不破坏连贯）
 * @param {Array<{ role: string; content?: string }>} messages
 * @param {number} maxChars
 * @returns {Array<{ role: string; content?: string }>}
 */
function trimMessagesToBudget(messages, maxChars = INPUT_BUDGET_CHARS) {
  if (!Array.isArray(messages)) return messages
  const total = totalMessageChars(messages)
  if (total <= maxChars) return messages
  const out = [...messages]
  const lastUserIndex = out.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0).pop()
  if (lastUserIndex == null) return messages
  const overflow = total - maxChars
  const lastContent = out[lastUserIndex].content || ''
  if (lastContent.length <= overflow) return messages
  const trimmed = trimToCharLimit(lastContent, lastContent.length - overflow, { fromEnd: true })
  out[lastUserIndex] = { ...out[lastUserIndex], content: trimmed }
  return out
}

export {
  CONTEXT_MAX_TOKENS,
  OUTPUT_RESERVE_TOKENS,
  INPUT_BUDGET_TOKENS,
  INPUT_BUDGET_CHARS,
  trimToCharLimit,
  totalMessageChars,
  trimMessagesToBudget,
}
