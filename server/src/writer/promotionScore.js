/**
 * 番茄推流验证分（Tomato Promotion Score）
 * 基于番茄算法生死线（500本扑街书分析 + 平台规则）的本地确定性评分：
 * 6 维度 × 10 分 = 60 分制，满分（60/60）才允许发布。
 *
 * 维度：
 * 1. 开篇钩子（前300字）——3秒留人
 * 2. 章尾钩（末200字）——追读率
 * 3. 完读率友好（手机端段落/句长/对话）
 * 4. 爽点与推进（动作/事件/小高潮）
 * 5. AI 味控制（省略号/破折号/模板词/极端词）
 * 6. 格式合规（标点/系统行/字数/无Markdown）
 */

const HOOK_KEYWORDS = [
  '突然', '下一秒', '危机', '任务', '警告', '死', '血', '砸', '撞', '追', '跑', '杀',
  '异常', '绑定', '系统', '警告', '不对劲', '出事了', '完了', '倒计时', '威胁', '陷阱',
  '不是', '竟然', '居然', '明明', '怎么会', '什么情况',
  '炸开', '开启', '激活', '强制', '规则', '降临', '异变', '弹出', '抹除', '失败', '回收',
];

const CLIFF_KEYWORDS = [
  '突然', '下一秒', '这时', '门外', '脚步', '系统', '任务', '倒计时', '还没', '竟然', '居然',
  '？', '！', '…', '来了', '完了', '不对劲', '电话', '消息', '门开了', '回头',
];

const AI_WORDS = [
  [/不禁|不由|顿时|瞬间/g, 1],
  [/仿佛|宛如|如同|好似/g, 1],
  [/嘴角抽|瞳孔|深吸一口气|深吸了口/g, 1],
  [/然而|与此同时|不仅如此/g, 1],
  [/微微|缓缓|渐渐/g, 1],
  [/非常|极其|无比|十分|特别|巨大/g, 0.5],
  [/不是[^。！？\n]{0,20}，?(也)?不是[^。！？\n]{0,20}，?而是/g, 1],
  [/命运|羁绊|深渊|试炼|宿命|灵魂深处/g, 1],
];

const SYSTEM_LINE_RE = /^\s*【[^】]{2,30}】\s*$/;

/** 正常叠词白名单（太太/点点/慢慢…），排除后才是语病 */
const NORMAL_DOUBLES = /太太|点点|慢慢|刚刚|偏偏|恰恰|常常|年年|天天|时时|处处|层层|哥哥|姐姐|妹妹|弟弟|星星|奶奶|爷爷|妈妈|爸爸|人人|个个|种种|件件|声声|步步|阵阵|家家|户户|双双|对对|久久|远远|近近|深深|浅浅|高高|矮矮|厚厚|薄薄|宽宽|窄窄|长长|短短/;

/**
 * 单章推流验证分
 * @param {string} text 章节正文
 * @param {number} targetChars 目标字数
 * @returns {{ ok: boolean, total: number, max: number, dims: Array<{name:string, score:number, issues:string[]}>, fixHints: string[] }}
 */
export function scorePromotion(text, targetChars = 2000) {
  const body = String(text || '');
  const chars = body.replace(/\s/g, '').length;
  const lead = body.slice(0, 300);
  const tail = body.slice(-200);
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const sentences = body.split(/[。！？!?]/).filter((s) => s.length > 2);
  const lens = sentences.map((s) => s.length);
  const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const dialogueCount = (body.match(/[“"][^”"\n]{2,40}[”"]/g) || []).length;

  const dims = [];

  /* 1. 开篇钩子（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    if (!lead.trim()) { score = 0; issues.push('无正文'); }
    else {
      const hit = HOOK_KEYWORDS.filter((k) => lead.includes(k)).length;
      const firstSentence = sentences[0] || '';
      if (hit === 0) { score -= 4; issues.push('前300字无冲突/危机/悬念信号'); }
      if (firstSentence.length > 40) { score -= 2; issues.push('第一句偏长（>40字），未直给事件'); }
      if (/清晨|阳光|天空|微风|街道.*缓缓|窗外.*阳光/.test(lead)) { score -= 2; issues.push('疑似风景/环境开场，需直进冲突'); }
      if (hit >= 1 && firstSentence.length <= 30) score += 0;
      score = Math.max(0, score);
    }
    dims.push({ name: '开篇钩子', score, issues });
  })();

  /* 2. 章尾钩（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    const tailHit = CLIFF_KEYWORDS.filter((k) => tail.includes(k)).length;
    if (tailHit === 0) { score -= 5; issues.push('章尾200字无悬念信号（疑问/倒计时/新威胁/未解问题）'); }
    const lastSentence = [...sentences].pop() || '';
    if (lastSentence && /句号。$/.test(lastSentence.trim()) && tailHit < 2) { score -= 2; issues.push('最后一句是平铺陈述，建议在“即将揭晓”处断章'); }
    score = Math.max(0, score);
    dims.push({ name: '章尾钩', score, issues });
  })();

  /* 3. 完读率友好（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    if (avgLen > 25) { score -= 3; issues.push(`平均句长${avgLen.toFixed(0)}字（>25），番茄宜15-22字`); }
    if (avgLen > 30) { score -= 2; issues.push('句长严重超标'); }
    const longParas = paragraphs.filter((p) => p.length > 200).length;
    if (longParas > 0) { score -= 3; issues.push(`超长段落${longParas}段（>200字），手机端需拆段`); }
    const paraAvg = paragraphs.length ? chars / paragraphs.length : 0;
    if (paraAvg > 140 && paragraphs.length > 0) { score -= 1; issues.push('平均段落偏长'); }
    if (dialogueCount < 2 && chars > 800) { score -= 2; issues.push('对话不足（<2处），番茄读者爱看对话'); }
    score = Math.max(0, score);
    dims.push({ name: '完读率友好', score, issues });
  })();

  /* 4. 爽点与推进（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    const actionSignals = (body.match(/一把|狠狠|猛地|直接|当场|反手|冷笑|嗤笑|冲|扑|掀|摔|拍|砸|亮出|掏出|拉开|推开|攥|握|拽|拉|踢|踩|按|拎|抓|甩|颠|渗|拐|压着|抵住|扒拉|踹/g) || []).length;
    // 变数信号：明示反转词 + 章尾新信息信号（系统提示/数字/时间/截断语/新称呼）——自然反转不靠明示词
    const tail150 = body.slice(-150);
    const twistSignals = (body.match(/没想到|居然|竟然|反转|真相|原来|才发现|不对劲|完了|糟了/g) || []).length
      + (tail150.match(/【[^】]{2,20}】|\d|…|换掉|变了|回来了|出现|多出|消失|没接|别接|越来越近|别让|跑了|铁锈|血|活的|五个人|脚步声/g) || []).length;
    if (actionSignals < 3) { score -= 3; issues.push('动作/冲突描写不足（<3处），推进感弱'); }
    if (twistSignals < 1 && chars > 800) { score -= 2; issues.push('本章缺少反转/意外信号'); }
    if (chars < targetChars * 0.9) { score -= 3; issues.push(`字数不足（${chars}<${targetChars * 0.9}），番茄要求达标篇幅`); }
    score = Math.max(0, score);
    dims.push({ name: '爽点与推进', score, issues });
  })();

  /* 5. AI 味控制（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    let penalty = 0;
    for (const [re, w] of AI_WORDS) {
      const n = (body.match(re) || []).length;
      if (n > 0) { penalty += n * w; issues.push(`${re.source.slice(0, 14)}…×${n}`); }
    }
    const ellipsis = (body.match(/……/g) || []).length;
    const dash = (body.match(/——/g) || []).length;
    if (ellipsis > 8) { penalty += (ellipsis - 8); issues.push(`省略号×${ellipsis}（>8）`); }
    if (dash > 2) { penalty += (dash - 2) * 2; issues.push(`破折号×${dash}（>2）`); }
    if (penalty > 0) score = Math.max(0, 10 - penalty);
    dims.push({ name: 'AI味控制', score, issues: issues.slice(0, 5) });
  })();

  /* 6. 格式合规（满分10） */
  (() => {
    const issues = [];
    let score = 10;
    if (/\*\*|\*|`|#\s/.test(body)) { score -= 2; issues.push('含 Markdown 残留'); }
    if (/【[^】]*】[^。！？\n，,]/.test(body)) { score -= 2; issues.push('【】块后紧跟标点/文字'); }
    if (/[a-zA-Z]{4,}/.test(body)) { score -= 1; issues.push('含长英文串'); }
    if (/[“"]{1}[”"]/.test(body)) { score -= 1; issues.push('存在空引号对话'); }
    if (chars < targetChars * 0.96) { score -= 2; issues.push(`字数未达标（${chars}/${targetChars}）`); }
    if (/。。|，，|！！|？？/.test(body)) { score -= 1; issues.push('连续标点错误'); }
    // 常见语病（AI 高频写错）
    if (/还没睡(?!醒)/.test(body)) { score -= 2; issues.push('语病：应为「还没睡醒」'); }
    if (/([他了是就也又在不都还没吧呢啊呀])\1(?=[，。！？])/.test(body)) { score -= 1; issues.push('叠字语病（如"他他""了了"）'); }
    if (/感觉.{0,8}感觉|觉得.{0,8}觉得/.test(body)) { score -= 1; issues.push('「感觉/觉得」重复啰嗦'); }
    // 无标点长句（番茄短句阅读：单句无标点 run 不应超过 24 字）
    const longRuns = (body.match(/[一-龥]{20,}/g) || []).filter((r) => !/[，。！？、；：…]/.test(r)).length;
    if (longRuns > 0) { score -= Math.min(4, longRuns); issues.push(`无标点长句×${longRuns}（>20字连续无标点，需断句）`); }
    score = Math.max(0, score);
    dims.push({ name: '格式合规', score, issues });
  })();

  const total = dims.reduce((a, d) => a + d.score, 0);
  const max = 60;
  const ok = total === max;
  const fixHints = [];
  if (!ok) {
    for (const d of dims) {
      if (d.score < 10) {
        fixHints.push(`【${d.name}】${d.issues.join('；')}`);
      }
    }
  }
  return { ok, total, max, dims, fixHints, stats: { chars, avgLen: Math.round(avgLen * 10) / 10, dialogueCount, paragraphCount: paragraphs.length } };
}

/** 全本推流验证统计 */
export function scorePromotionBook(chapters) {
  const rows = chapters.map(({ n, text, target }) => {
    const r = scorePromotion(text, target);
    return { n, ...r };
  });
  const passed = rows.filter((r) => r.ok).length;
  const avg = rows.length ? rows.reduce((a, r) => a + r.total, 0) / rows.length : 0;
  return {
    rows,
    summary: {
      chapterCount: rows.length,
      passed,
      failed: rows.length - passed,
      avgTotal: Math.round(avg * 10) / 10,
      fullMark: rows.length > 0 && passed === rows.length,
    },
  };
}
