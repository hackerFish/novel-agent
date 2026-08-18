/**
 * 自动审查修复流水线（token 高效版）
 * 原则：
 * 1. 本地确定性优先（零 token）：AI 词/断句/格式/比喻密度检测
 * 2. 补丁式 LLM 修复：只输出改动片段 {find, replace}，不全文重写（省 token 且不劣化）
 * 3. 审查用 aux（flash），修复用 main（pro）
 */
import { chat } from '../llm/adapter.js';
import { humanizePunctuationSafe, localDeAi } from './humanize.js';
import { applyLocalFormatPass } from './formatEngine.js';
import { thirdPartyReviewChapter } from './thirdPartyReview.js';

/** 本地比喻密度检测：每 400 字超过 N 个"像X"比喻 = 超标 */
export function checkMetaphorDensity(text, threshold = 3) {
  const body = String(text || '');
  const matches = [...body.matchAll(/像[一-龥]{2,14}/g)];
  if (!matches.length) return { ok: true, count: 0, ratio: 0 };
  const chars = body.replace(/\s/g, '').length;
  const ratio = matches.length / Math.max(1, chars / 400);
  const samples = matches.slice(0, 8).map((m) => m[0]);
  return {
    ok: ratio <= threshold,
    count: matches.length,
    ratio: Math.round(ratio * 10) / 10,
    samples,
    hint: `比喻密度 ${ratio}/400字（阈值 ${threshold}），超标需精简`,
  };
}

/** 本地规则修复（零 token）：AI 词 + 断句 + 格式 */
export function localRepair(text) {
  let out = humanizePunctuationSafe(text, 0.8);
  out = applyLocalFormatPass(out);
  return out;
}

/**
 * 补丁式 LLM 修复：根据审查意见只修改被指出的片段
 * @param {string} chapterText 章节全文
 * @param {object} review 三方审查结果（含 issues/aiTraces/读者意见）
 * @param {object} opts { chapterTitle }
 * @returns {{ applied: number, skipped: number, patches: Array<{find:string,replace:string}> }}
 */
export async function patchRepair(chapterText, review, opts = {}) {
  const issues = collectReviewIssues(review);
  if (!issues.length) return { applied: 0, skipped: 0, patches: [] };

  const prompt = `你是番茄小说的专业改稿编辑。下面的章节有若干问题，请用"最小改动"修复：只修改被指出的片段，其余一字不动。

【修改方式】（严格 JSON，不要其他文字）
- 输出 JSON 数组，每项 { "find": "原文中要替换的精确片段（尽量短，5-80字，必须与原文完全一致）", "replace": "替换后的新片段" }
- 每个问题最多 2 个补丁；没有把握精确定位的问题跳过，不要硬改
- 禁止改变剧情、人物、设定；禁止大段重写；禁止在 replace 中引入"没想到/居然/突然/反转"等明示词
- 比喻修复：把"像X"的堆砌比喻改为具体动作/直接描写（如"像条蛇在爬"→"贴着地皮扭"），每章最多保留 1-2 个比喻
- 主角主动性：让主角有验证、反抗、吐槽等主动行为，而不是纯被动接受
- 系统规则交代：在恰当位置补 1 句过渡/伏笔，让设定自洽

【待修问题清单】
${issues.slice(0, 12).map((x, i) => `${i + 1}. [${x.sev}] ${x.problem}${x.fix ? `（建议：${x.fix}）` : ''}`).join('\n')}

【章节标题】${opts.chapterTitle || ''}

【章节全文】
${chapterText.slice(0, 12000)}`;

  const r = await chat(
    [{ role: 'system', content: '你是番茄小说改稿编辑，只输出补丁 JSON 数组，禁止输出其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 4096, temperature: 0.4, thinking: false }
  );
  const raw = (r.content || '').trim();
  let patches = [];
  try {
    const jsonText = raw.match(/\[[\s\S]*\]/)?.[0] || raw;
    patches = JSON.parse(jsonText);
    if (!Array.isArray(patches)) patches = [];
  } catch {
    return { applied: 0, skipped: 0, patches: [], parseError: raw.slice(0, 200) };
  }

  // 应用补丁：精确匹配替换，逐条进行
  let applied = 0;
  let skipped = 0;
  let out = chapterText;
  for (const p of patches) {
    const find = String(p?.find || '').trim();
    const replace = String(p?.replace || '').trim();
    if (!find || !replace || find.length > 120) { skipped += 1; continue; }
    const idx = out.indexOf(find);
    if (idx === -1) { skipped += 1; continue; }
    out = out.slice(0, idx) + replace + out.slice(idx + find.length);
    applied += 1;
  }
  return { applied, skipped, patches, appliedText: applied > 0 ? out : null };
}

/** 从三方审查结果提取待修问题（去重、分级） */
function collectReviewIssues(review) {
  const sevMap = { 致命: 0, 严重: 1, 一般: 2, 轻微: 3 };
  const seen = new Set();
  const issues = [];
  const push = (sev, problem, fix) => {
    if (!problem) return;
    const key = problem.slice(0, 20);
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ sev: sev || '一般', problem: String(problem).slice(0, 120), fix: fix ? String(fix).slice(0, 120) : '' });
  };
  for (const role of ['editor', 'reader', 'literary']) {
    const p = review?.results?.[role]?.parsed;
    if (!p) continue;
    (p.criticalIssues || p.issues || []).forEach((it) => push(it.severity, it.problem, it.fix));
    (p.whatMadeMeLeave || []).forEach((w) => push('一般', w));
    if (p.aiTraces && Array.isArray(p.aiTraces)) p.aiTraces.forEach((a) => push('严重', a));
    if (p.aiFeeling && p.aiFeeling !== '无') push('一般', p.aiFeeling);
    if (p.aiFlavor && p.aiFlavor !== '无') push('一般', p.aiFlavor);
  }
  // 本地比喻密度检测并入
  return issues.sort((a, b) => (sevMap[a.sev] ?? 9) - (sevMap[b.sev] ?? 9));
}

/**
 * 完整自动修复流水线（每章）：
 * 三方审查 → 本地修复(0 token) → 补丁式 LLM 修复(pro) → 本地清洗 → 返回
 * @returns {{ ok, promotion, review, patch: {applied, skipped}, metaphor, finalText, skippedPatch }}
 */
export async function runAutoRepair(chapterText, meta = {}, opts = {}) {
  const { skipReview = false, targetChars = 2000 } = opts;

  // 1. 三方审查（aux 模型，省 token）
  let review = null;
  if (!skipReview) {
    review = await thirdPartyReviewChapter(chapterText, meta);
  }

  // 2. 本地比喻密度检测（0 token）
  const metaphor = checkMetaphorDensity(chapterText);

  // 3. 补丁式修复（pro，精准局部）
  let patched = chapterText;
  let patch = { applied: 0, skipped: 0, patches: [] };
  if (review && (collectReviewIssues(review).length > 0 || !metaphor.ok)) {
    // 比喻超标时，把比喻问题注入清单
    const issues = collectReviewIssues(review);
    if (!metaphor.ok) issues.push({ sev: '严重', problem: `比喻堆砌：${metaphor.samples.join('、')}，需精简为具体动作描写`, fix: '删减一半比喻，保留1-2个核心，其余改具体动作' });
    const customReview = { results: { editor: { parsed: { criticalIssues: issues } }, reader: null, literary: null } };
    patch = await patchRepair(chapterText, customReview, meta);
    if (patch.appliedText) patched = patch.appliedText;
  }

  // 4. 本地清洗（AI 词/断句/格式，0 token）
  const finalText = localRepair(patched);

  return { ok: true, review, metaphor, patch, finalText };
}
