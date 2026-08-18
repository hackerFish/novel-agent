/**
 * 商业化三件套：书名候选 + 简介 3 版 + 标签 + 推荐
 * 基于番茄爆款命名法（书名即钩子）+ 设定/黄金三章生成上架文案
 */
import { chat } from '../llm/adapter.js';

export function buildCommercialPackPrompt({ topic = '', genre = '', setting = '', goldenChapters = '', existingTitle = '' }) {
  return `你是番茄小说的商业化策划（精通爆款命名法与上架文案）。请为一本新书产出"商业化三件套"：书名、简介、标签。

【作品信息】
${topic ? `主题/点子：${topic}` : ''}
${genre ? `类型：${genre}` : ''}
${existingTitle ? `暂定名：${existingTitle}` : ''}
${setting ? `\n【设定】\n${setting.slice(0, 3000)}` : ''}
${goldenChapters ? `\n【黄金三章（前3章开头，用于提炼卖点）】\n${goldenChapters.slice(0, 2500)}` : ''}

【爆款命名法参考】
- 书名即钩子：《我，圈钱主播，但大哥是真刷啊》《我在精神病院学斩神》《谁让他修仙的！》《三日终焉》
- 好书名 = 金手指/反差/悬念 直接写进书名，口语化，3 秒说清"这本书是干嘛的"
- 番茄读者下沉，书名要一眼懂、有记忆点、能引起"卧槽还能这样"

【输出格式】（严格 JSON，不要其他文字）
{
  "titles": [
    {"title": "书名1", "reason": "钩子逻辑（一句话）"},
    {"title": "书名2", "reason": "钩子逻辑"},
    {"title": "书名3", "reason": "钩子逻辑"},
    {"title": "书名4", "reason": "钩子逻辑"},
    {"title": "书名5", "reason": "钩子逻辑"}
  ],
  "recommendedTitle": "推荐哪个书名，为什么",
  "intros": [
    {"version": "A（悬念流）", "text": "300字内简介"},
    {"version": "B（爽点流）", "text": "300字内简介"},
    {"version": "C（猎奇流）", "text": "300字内简介"}
  ],
  "recommendedIntro": "推荐哪个简介",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5", "标签6", "标签7", "标签8"],
  "coreTags": ["核心标签，3-5个"],
  "marketingAngle": "上架营销角度（一句话）"
}`;
}

export async function runCommercialPack({ topic = '', genre = '', setting = '', goldenChapters = '', existingTitle = '' } = {}) {
  if (!topic && !setting) throw new Error('缺少作品信息');
  const prompt = buildCommercialPackPrompt({ topic, genre, setting, goldenChapters, existingTitle });
  const r = await chat(
    [{ role: 'system', content: '你是番茄商业化策划，只输出 JSON，禁止其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 4096, temperature: 0.5, thinking: false }
  );
  const raw = (r.content || '').trim();
  try {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    return { ok: true, pack: JSON.parse(jsonText) };
  } catch {
    return { ok: false, raw, error: '商业化方案解析失败' };
  }
}
