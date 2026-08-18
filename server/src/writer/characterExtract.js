/**
 * 角色档案增量提取：从新完成章节提取每个角色的变化（外貌/性格/能力/关系/弧光）
 * 省 token 策略：只输出变化字段，未变化的角色不出现在结果中。
 */
import { chat } from '../llm/adapter.js';
import { upsertCharacterProfile, evolveCharacterPercentages } from './bookState.js';

const EXTRACT_PROMPT = (chapterText, chapterNumber) => `你是小说角色档案员。阅读章节，提取其中出场角色的"变化信息"更新档案。

【规则】
- 只提取本章出现的角色；角色外貌首次明确描写时记 appearance，变化时更新
- 能力获得/升级记入 abilities（新增项）
- 关系变化记入 relationships（如"苏晚=房东/搭档"）
- 重要剧情转折/心境变化记入 arcNote（一句话，如"第5章：被迫接受系统"）
- 没有新信息的角色不输出；没有变化的字段不输出
- 不要编造，只基于本章文本

【输出格式】（严格 JSON，不要其他文字）
{"characters": [{"name": "角色名", "updates": {"appearance": "可选", "personality": "可选", "abilities": ["新增能力"], "relationships": {"对方": "关系"}, "arcNote": "可选"}}]}

【第 ${chapterNumber} 章正文】
${chapterText.slice(0, 10000)}`;

/**
 * 从章节提取角色变化并更新档案
 * @param {string} bookId
 * @param {string} chapterText
 * @param {number} chapterNumber
 * @param {number} totalChapters 用于演进百分比（可选）
 */
export async function extractCharacterUpdates(bookId, chapterText, chapterNumber, totalChapters = 0) {
  if (!bookId || !chapterText) return { updated: 0 };
  const prompt = EXTRACT_PROMPT(chapterText, chapterNumber);
  const r = await chat(
    [{ role: 'system', content: '你是小说角色档案员，只输出 JSON，禁止其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 2048, temperature: 0.3, model: 'aux', thinking: false }
  );
  const raw = (r.content || '').trim();
  let parsed = null;
  try {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    parsed = JSON.parse(jsonText);
  } catch {
    return { updated: 0, raw: raw.slice(0, 200) };
  }
  const list = Array.isArray(parsed?.characters) ? parsed.characters : [];
  let updated = 0;
  for (const item of list) {
    if (item?.name) {
      upsertCharacterProfile(bookId, { name: item.name, updates: item.updates || {}, lastSeenChapter: chapterNumber });
      updated += 1;
    }
  }
  if (updated > 0 && totalChapters > 0) {
    evolveCharacterPercentages(bookId, totalChapters);
  }
  return { updated };
}
