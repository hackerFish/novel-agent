/**
 * 番茄平台可读性本地评分（无 LLM），目标 9.0 档成稿门槛
 */

function countChars(text) {
  return String(text || '').replace(/\s/g, '').length;
}

function countMatches(text, regex) {
  return ((text || '').match(regex) || []).length;
}

/** 本地番茄追读指标，满分 10 */
export function scoreTomatoReadability(text, targetChars = 2000) {
  const body = String(text || '');
  const length = countChars(body);
  const lead = body.slice(0, 450);
  const tail = body.slice(-450);
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const hookScore = /[“【？！]/u.test(lead) || /(忽然|突然|下一秒|危机|任务|系统|直播|弹幕|警告|死|血|砸|撞|追|跑|杀|异常)/u.test(lead)
    ? 8.5
    : 5.5;
  const cliffScore = /[？！…]/u.test(tail) || /(忽然|突然|下一秒|这时|门外|脚步|系统|任务|倒计时|还没|竟然|居然)/u.test(tail)
    ? 8.5
    : 5.5;
  const avgPara = paragraphs.length ? length / paragraphs.length : length;
  const readabilityScore = avgPara <= 140 ? 8.5 : avgPara <= 180 ? 7 : 5.5;
  const paceScore = length >= targetChars * 0.94 ? 8 : length >= targetChars * 0.85 ? 6.5 : 4.5;
  const dialogueScore = countMatches(body, /[“"][^”"\n]{4,}[”"]/gu) >= 2 ? 8 : 6;

  const scores = {
    hook: hookScore,
    pace: paceScore,
    readability: readabilityScore,
    dialogue: dialogueScore,
    cliffhanger: cliffScore,
    platformFit: 8,
  };
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length;
  return { scores, average: Math.round(avg * 10) / 10 };
}

export function collectTomatoLocalIssues(text, targetChars = 2000) {
  const issues = [];
  const { scores } = scoreTomatoReadability(text, targetChars);
  const tail = String(text || '').slice(-450);

  if (scores.hook < 7.5) {
    issues.push('开头钩子偏弱：前几段需更快抛出异常、危机、任务或冲突');
  }
  if (scores.cliffhanger < 7.5) {
    issues.push('章尾追读钩子不足：结尾需更明确的风险、发现、选择或代价');
  }
  if (scores.readability < 7.5) {
    issues.push('手机端分段偏重：需拆短段落，对话与动作转折处主动分段');
  }
  if (scores.pace < 7) {
    issues.push(`推进感不足或篇幅偏短：目标约 ${targetChars} 字，需补足事件推进`);
  }
  if (!/[？！…]|突然|忽然|竟然|还没|下一/u.test(tail)) {
    issues.push('章尾缺少悬念落点：最后 2-3 段应留下未解问题或即将发生的变故');
  }
  if (/不是[^。！？\n]{0,24}，?(也)?不是[^。！？\n]{0,24}，?而是/u.test(text)) {
    issues.push('仍有「不是…而是…」模板对照句，需改成林照式动作或短句');
  }
  return issues;
}

/** 是否达到番茄 9.0 近似门槛（本地启发式，非平台真实评分） */
export function passesTomatoLocalGate(text, styleQuality, targetChars = 2000) {
  if (!styleQuality?.ok) return false;
  const { average, scores } = scoreTomatoReadability(text, targetChars);
  if (average < 8.2) return false;
  if (scores.hook < 7.5 || scores.cliffhanger < 7.5) return false;
  return true;
}

export function buildLocalTomatoReview(text, styleQuality, targetChars = 2000) {
  const { scores, average } = scoreTomatoReadability(text, targetChars);
  const issues = collectTomatoLocalIssues(text, targetChars);
  const styleIssues = styleQuality?.issues || [];
  return {
    pass: passesTomatoLocalGate(text, styleQuality, targetChars),
    summary: average >= 8.5
      ? '本地番茄可读性达标，追读节奏与章尾钩子合格'
      : '本地番茄可读性未达 9.0 档，建议润稿加强钩子与章尾',
    scores: {
      ...scores,
      emotion: styleIssues.some((i) => /模板|省略号|对照/.test(i)) ? 7 : 8,
    },
    issues: [
      ...styleIssues.map((problem) => ({
        severity: /开头|篇幅偏短|章尾/.test(problem) ? 'high' : 'medium',
        type: 'platformFit',
        problem,
        fix: '按番茄移动端追读习惯压缩解释、增强钩子、拆短段落',
      })),
      ...issues.map((problem) => ({
        severity: 'medium',
        type: 'platformFit',
        problem,
        fix: '加强目标-阻碍-反馈-章尾钩子四步结构',
      })),
    ],
    strengths: average >= 8.2 ? ['本地可读性指标合格'] : [],
    repairNeeded: !passesTomatoLocalGate(text, styleQuality, targetChars),
    fallback: true,
    localAverage: average,
  };
}
