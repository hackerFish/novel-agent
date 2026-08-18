/**
 * 拆书分析：从爆款书逆向提炼可复用套路（写法库）
 * 输入：书名 + 简介 +（可选）章节样本
 * 输出：题材定位/剧情结构/钩子节奏/人物系统/世界设定/写法技法/可复用套路/提示词
 * 存入全局写法库（.t-book-state/patterns.json），写章时可注入。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chat } from '../llm/adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', '..', '..', '.t-book-state');
const PATTERNS_FILE = path.join(STATE_DIR, 'patterns.json');

function loadPatterns() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    if (fs.existsSync(PATTERNS_FILE)) return JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
  } catch { /* 重建 */ }
  return { list: [] };
}

function savePatterns(patterns) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(PATTERNS_FILE, JSON.stringify(patterns, null, 2), 'utf8');
}

/** 读取写法库（跨书全局资产） */
export function getPatterns() {
  return loadPatterns().list || [];
}

/** 存一条拆书套路 */
export function savePattern(pattern) {
  const p = loadPatterns();
  const exist = p.list.find((x) => x.book === pattern.book);
  if (exist) {
    Object.assign(exist, pattern, { savedAt: new Date().toISOString() });
  } else {
    p.list.unshift({ ...pattern, savedAt: new Date().toISOString() });
  }
  savePatterns(p);
  return pattern;
}

/**
 * 生成拆书 prompt
 * @param {object} opts { book, intro, sampleText } 至少提供 book（书名），intro/sampleText 可选
 */
export function buildDeconstructPrompt({ book = '', intro = '', sampleText = '' } = {}) {
  return `你是网文行业研究专家，专门拆解爆款小说提炼可复用方法论。请拆解以下作品，输出结构化报告。

【作品】${book || '未提供'}
${intro ? `【简介】${intro}` : ''}
${sampleText ? `【章节样本（供文风分析）】\n${sampleText.slice(0, 3000)}` : ''}
${!intro && !sampleText ? '\n（未提供简介和章节，请基于你对这部作品的了解拆解；不了解的维度标注"未知"）' : ''}

【输出格式】（严格 JSON，不要其他文字）
{
  "book": "书名",
  "genre": "题材定位（一句话）",
  "coreSellingPoint": "核心卖点（读者为什么看）",
  "structure": {
    "act1": "开局（第1-N章做什么，钩子怎么埋）",
    "act2": "发展（中期节奏、升级、爽点规律）",
    "act3": "高潮与收束（怎么引爆、怎么结尾）"
  },
  "hookRhythm": "钩子节奏规律（每几章一个钩子、钩子类型）",
  "characterSystem": ["人物系统要点（主角特质/配角功能/反派设计），2-4条"],
  "worldSetting": "世界设定要点（规则/格局/压迫感来源）",
  "writingTechniques": {
    "爽点密度": "具体写法",
    "章尾钩": "具体写法",
    "节奏": "具体写法",
    "真人味": "具体写法"
  },
  "reusablePatterns": ["可直接复用的套路/结构/设定，3-6条，每条约20-50字"],
  "reusablePrompts": ["可直接复用的写作提示词片段，2-3条"],
  "whatToAvoid": ["模仿时容易踩的坑，2-3条"]
}`;
}

/**
 * 执行拆书
 * @returns {{ ok, deconstruction, saved }}
 */
export async function runDeconstruct({ book = '', intro = '', sampleText = '', save = true } = {}) {
  if (!book) throw new Error('缺少书名');
  const prompt = buildDeconstructPrompt({ book, intro, sampleText });
  const r = await chat(
    [{ role: 'system', content: '你是网文行业研究专家，只输出 JSON，禁止输出其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 4096, temperature: 0.4, thinking: false }
  );
  const raw = (r.content || '').trim();
  let parsed = null;
  try {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, raw, error: '拆书结果解析失败' };
  }
  if (save) savePattern(parsed);
  return { ok: true, deconstruction: parsed, saved: save };
}

/** 生成可注入写章的"写法库提示"（可选注入） */
export function formatPatternsSection(patterns, max = 3) {
  const list = Array.isArray(patterns) ? patterns.slice(0, max) : [];
  if (!list.length) return '';
  const lines = [];
  for (const p of list) {
    lines.push(`【参考《${p.book}》】${p.coreSellingPoint || ''}`);
    (p.reusablePatterns || []).slice(0, 2).forEach((pat) => lines.push(`- ${pat}`));
  }
  return `【写法库参考】（可借鉴的爆款套路，注意不要抄袭，要融合进本书设定）\n${lines.join('\n')}`;
}
