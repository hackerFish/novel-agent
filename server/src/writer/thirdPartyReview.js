/**
 * 第三方专业审查：三个独立专业角色分别审查章节，交叉验证后汇总裁定。
 * 1. 资深番茄签约编辑（平台/商业视角）
 * 2. 番茄追读老读者（读者体验视角）
 * 3. 出版级文学编辑（文笔/逻辑/真人味视角）
 */
import { chat } from '../llm/adapter.js';

function buildReviewerPrompt(role, chapterText, meta) {
  const { title, summary, globalSummary } = meta || {};
  const ch = chapterText.slice(0, 12000);
  if (role === 'editor') {
    return `你是一位在番茄小说工作 6 年的资深签约编辑，负责评估新书黄金三章能否签约、能否起量。请独立审查下面的章节，输出专业评审。

【评审标准（番茄 2026 实况）】
- 前三章留存率是生死线：开篇 300 字必须直给冲突/危机/事件
- 完读率友好：手机端段落、短句、对话密度
- 爽点节奏：每 3-5 章一次小高潮，前 3 章必须立住卖点
- 章尾钩：每章结尾是否让人必须点下一章
- 平台合规：血腥/迷信/违规词
- AI 水文风险：番茄 2026 严打 AI 痕迹（省略号刷屏、破折号、模板词、"不是…而是…"句式、抽象大词、整齐句式）——这本要被平台判定"AI 痕迹明显"，直接关系能否过审和全勤
- 商业潜力：题材卖点、书名匹配度、追读预期

【本章信息】${title || ''} ${summary || ''}${globalSummary ? `\n【前文摘要】${globalSummary.slice(0, 800)}` : ''}

【章节正文】
${ch}

【输出格式】（严格 JSON，不要其他文字）
{
  "verdict": "通过/有条件通过/不通过",
  "score": 0,
  "scoreBreakdown": {"开篇钩子": 0, "完读率": 0, "爽点节奏": 0, "章尾钩": 0, "合规": 0, "AI水文风险": 0, "商业潜力": 0},
  "strengths": ["2-3条优点"],
  "criticalIssues": [{"severity": "致命/严重/一般", "problem": "具体问题", "fix": "具体改法"}],
  "aiTraces": ["检测到的具体AI痕迹，没有就写无"],
  "verdictReason": "一句话结论"
}`;
  }
  if (role === 'reader') {
    return `你是一个在番茄追书 5 年的老读者，口味刁钻，每天刷几十本新书，看三章就决定追不追。请以真实读者身份独立评价下面的章节，输出你的真实感受。

【你关心的事】
- 第 1 章前 300 字，我会不会划走？
- 主角立不立得住？我想不想代入他？
- 爽不爽？有没有让我"这口气出得真爽"的瞬间？
- 看完第 3 章结尾，我点不点第 4 章？
- 有没有 AI 味（读着像机器写的、太工整、情绪太平均、句子太顺）让我出戏？
- 哪里让我觉得假/尴尬/想弃书？

【本章信息】${title || ''} ${summary || ''}

【章节正文】
${ch}

【输出格式】（严格 JSON，不要其他文字）
{
  "verdict": "会追/犹豫/弃书",
  "score": 0,
  "scoreBreakdown": {"前三章留存": 0, "主角代入": 0, "爽感": 0, "追读欲": 0, "真人味": 0},
  "whatILiked": ["真实感受，口语化"],
  "whatMadeMeLeave": ["真实弃书点，口语化，没有就写无"],
  "aiFeeling": "这段哪里让我觉得像AI写的，具体到句子；没有就写无",
  "wouldIReadNext": "会不会点下一章，为什么"
}`;
  }
  return `你是一位出版级的文学编辑，做过十年网文长篇编辑，最擅长判断文字质量和逻辑。请独立评审下面的章节，标准是"能不能达到职业作家成稿水平"。

【评审维度】
- 句子节奏：长短交错？有呼吸感？还是整齐划一（AI特征）？
- 真人味：情绪是"演"出来的（动作/细节/潜台词）还是"喊"出来的（他很愤怒）？
- 对话：像真人说话吗？有口癖、打断、潜台词吗？
- 细节：有"无用信息"制造真实感吗？（外卖盒油渍、磨光的键盘）
- 逻辑自洽：设定内部矛盾？因果断裂？前后不一？
- 克制：省略号/破折号/感叹号是否滥用？有无为修辞而修辞？
- 结构：一章之内目标-阻碍-反馈是否完整？

【本章信息】${title || ''} ${summary || ''}

【章节正文】
${ch}

【输出格式】（严格 JSON，不要其他文字）
{
  "verdict": "达到成稿/需修改/不达标",
  "score": 0,
  "scoreBreakdown": {"句子节奏": 0, "真人味": 0, "对话": 0, "细节": 0, "逻辑": 0, "克制": 0, "结构": 0},
  "strengths": ["2-3条"],
  "issues": [{"severity": "严重/一般/轻微", "problem": "具体问题，引用原文", "fix": "具体改法"}],
  "aiFlavor": "具体哪句/哪段有AI味，怎么改",
  "overall": "一句话评价"
}`;
}

async function runReviewer(role, chapterText, meta) {
  const prompt = buildReviewerPrompt(role, chapterText, meta);
  const r = await chat(
    [{ role: 'system', content: '你是独立第三方专业评审，只输出 JSON，禁止输出其他文字。' }, { role: 'user', content: prompt }],
    { maxTokens: 2048, temperature: 0.4, thinking: false }
  );
  const raw = (r.content || '').trim();
  try {
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
    return { role, raw, parsed: JSON.parse(jsonText) };
  } catch {
    return { role, raw, parsed: null };
  }
}

/** 三方独立审查一章，返回三份独立报告 + 汇总 */
export async function thirdPartyReviewChapter(chapterText, meta = {}) {
  const results = {};
  for (const role of ['editor', 'reader', 'literary']) {
    try {
      results[role] = await runReviewer(role, chapterText, meta);
    } catch (e) {
      results[role] = { role, raw: '', parsed: null, error: e.message };
    }
  }

  // 汇总裁定
  const allVerdicts = Object.values(results).map((r) => r.parsed?.verdict || '解析失败');
  const passCount = allVerdicts.filter((v) => /通过|会追|达到/.test(v)).length;
  const scores = Object.values(results).map((r) => Number(r.parsed?.score) || 0);
  const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

  // 共识问题（至少两方提到的高频词）
  const issueTexts = Object.values(results)
    .map((r) => JSON.stringify(r.parsed?.criticalIssues || r.parsed?.issues || r.parsed?.whatMadeMeLeave || ''))
    .join(' ');

  return {
    results,
    summary: {
      verdicts: { editor: allVerdicts[0], reader: allVerdicts[1], literary: allVerdicts[2] },
      passCount,
      avgScore,
      consensus: passCount >= 2 ? '通过' : passCount === 1 ? '有条件通过' : '不通过',
      verdict: passCount >= 2 ? '可发布' : '需修改',
    },
  };
}
