/**
 * 整书打磨（Full-Book Polish）：全本写完后的书级审查
 * 输入：全书章节（抽样）+ 导演大纲蓝图 + 能力/伏笔状态 + 摘要
 * 输出：节奏/伏笔/重复/人设/爽点分布 + 优先级修改清单
 * token 策略：每章只取开头150字+结尾150字，最多抽样 40 章
 */
import { chat } from '../llm/adapter.js';
import { getAbilities, getForeshadows, getCharacterProfiles } from './bookState.js';

function parseChapterMeta(directory, n) {
  const blocks = (directory || '').split(/\n\s*\n/);
  const block = blocks.find((b) => b.includes(`第${n}章`)) || '';
  return {
    title: (block.match(/第\d+章\s*-\s*([^\n]+)/) || [])[1]?.trim() || '',
    summary: (block.match(/本章简述[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
    suspense: (block.match(/悬念密度[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
  };
}

/**
 * 组装书级审查输入（省 token：抽样）
 */
function buildPolishInput({ project, chapters, total }) {
  const directory = project.directory || '';
  // 抽样规则：前 3 章必选，之后每 5 章抽 1 章，最多 40 章
  const sampleSet = new Set([1, 2, 3]);
  for (let n = 5; n <= total && sampleSet.size < 40; n += 5) sampleSet.add(n);
  if (total > 3 && sampleSet.size < 40) {
    for (let n = total; n > 3 && sampleSet.size < 40; n -= 1) sampleSet.add(n);
  }

  const chapterLines = [];
  const sampleTexts = [];
  for (const n of [...sampleSet].sort((a, b) => a - b)) {
    const meta = parseChapterMeta(directory, n);
    const ch = chapters[n];
    if (ch) {
      const head = ch.slice(0, 150).replace(/\n/g, ' ');
      const tail = ch.slice(-150).replace(/\n/g, ' ');
      chapterLines.push(`${n}.《${meta.title || ''}》[${meta.suspense || ''}]${meta.summary ? ` ${meta.summary}` : ''}`);
      sampleTexts.push(`【第${n}章】开头：${head} …结尾：${tail}`);
    }
  }
  return { chapterLines, sampleTexts };
}

/**
 * 执行整书打磨
 * @param {object} opts { bookId, project, chapters, total, directorOutline }
 */
export async function runBookPolish({ bookId, project, chapters, total, directorOutline = '' }) {
  const { chapterLines, sampleTexts } = buildPolishInput({ project, chapters, total });
  const abilities = getAbilities(bookId).list || [];
  const foreshadows = getForeshadows(bookId).list || [];
  const characters = getCharacterProfiles(bookId);
  const characterNames = Object.keys(characters);

  const prompt = `你是番茄小说的总编辑，对一部长篇小说做【整书打磨审查】。你已经看过全书（抽样），请从书级视角诊断，输出结构化报告。

【导演大纲（蓝图）】
${directorOutline.slice(0, 5000)}

【章节总览】（抽样章节：标题/悬念密度/简述）
${chapterLines.slice(0, 45).join('\n')}

【抽样正文】（每章开头+结尾）
${sampleTexts.join('\n\n')}

【能力图鉴】${abilities.length ? abilities.map((a) => `${a.name}(${a.grade})`).join('、') : '暂无'}
【伏笔状态】${foreshadows.length ? `${foreshadows.length}条（已回收${foreshadows.filter((f) => f.status === 'harvested').length}，在途${foreshadows.filter((f) => ['planted', 'active'].includes(f.status)).length}，疑似遗忘${foreshadows.filter((f) => f.status === 'forgotten').length}）` : '暂无'}
【角色档案】${characterNames.length ? characterNames.join('、') : '暂无'}

【审查维度】
1. 整体节奏：按卷看爽点/高潮是否符合蓝图？哪里拖、哪里泄？
2. 伏笔核对：蓝图规划的伏笔实际埋设/回收情况？断的、忘的、回收过早的？
3. 重复检测：桥段/套路/用词重复？单元结构是否同质化？
4. 人设一致性：角色前后矛盾？工具人化？主角主动性？
5. 爽点分布：每 3-5 章有没有小高潮？哪里真空？
6. 读者留存：哪个阶段最可能弃书？

【输出格式】（严格 JSON，不要其他文字）
{
  "overall": "整体评价（一段话）",
  "verdict": "可完本/需重大修改/需局部修改",
  "rhythmAnalysis": "节奏分析（按卷，指出哪里拖/泄）",
  "foreshadowCheck": {"ok": true, "issues": ["伏笔问题，2-4条"]},
  "repetitionDetection": ["重复/同质化问题，2-3条"],
  "characterConsistency": ["人设问题，2-3条"],
  "pacingIssues": ["节奏/爽点真空问题，2-3条"],
  "dropRisk": "最可能弃书的阶段与原因",
  "prioritizedFixes": [{"priority": "高/中/低", "chapter": "章节号或区间", "problem": "问题", "fix": "具体改法"}]
}`;

  const r = await chat(
    [{ role: 'system', content: '你是番茄小说总编辑，只输出 JSON，禁止其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 4096, temperature: 0.4, thinking: false }
  );
  const raw = (r.content || '').trim();
  try {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    return { ok: true, polish: JSON.parse(jsonText) };
  } catch {
    return { ok: false, raw, error: '打磨报告解析失败' };
  }
}
