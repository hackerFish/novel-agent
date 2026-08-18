/**
 * AI 味指数逐句定位（本地确定性，0 token）
 * 对章节逐句评分 AI 味特征，输出指数（0-10）+ 问题句列表
 */
const SENTENCE_RE = /[^。！？!?\n]+[。！？!?]?/g;

const FEATURES = [
  { re: /……/g, label: '省略号滥用', weight: 1.5 },
  { re: /——/g, label: '破折号滥用', weight: 1.5 },
  { re: /不禁|不由|顿时|瞬间/g, label: '情绪副词', weight: 1.5 },
  { re: /仿佛|宛如|如同|好似/g, label: '比喻词', weight: 1.2 },
  { re: /嘴角抽|瞳孔|深吸一口气/g, label: '动作模板', weight: 1.2 },
  { re: /微微|缓缓|渐渐/g, label: '万能副词', weight: 1.2 },
  { re: /非常|极其|无比|十分/g, label: '极端词', weight: 1.0 },
  { re: /然而|与此同时|不仅如此/g, label: '转折词癖', weight: 1.0 },
  { re: /命运|羁绊|深渊|试炼|宿命/g, label: '抽象大词', weight: 1.2 },
  { re: /不是[^。！？\n]{0,18}，?(也)?不是[^。！？\n]{0,18}，?而是/g, label: '对照句', weight: 2.0 },
  { re: /像[一-龥]{2,12}/g, label: '比喻密集', weight: 0.8 },
  { re: /[！]{2,}/g, label: '连续感叹号', weight: 1.0 },
];

/** 单句 AI 味评分（0-10） */
function scoreSentence(sentence) {
  const reasons = [];
  let points = 0;
  for (const f of FEATURES) {
    const n = (sentence.match(f.re) || []).length;
    if (n > 0) {
      points += n * f.weight;
      reasons.push(`${f.label}×${n}`);
    }
  }
  // 句长惩罚：>35 字长句（无标点堆叠）
  const chars = sentence.replace(/[。！？!?…，、；：]/g, '').length;
  if (chars > 35) { points += (chars - 35) * 0.3; reasons.push(`长句${chars}字`); }
  // 排列整齐：连续同长度句（在整章层处理）
  return {
    score: Math.min(10, Math.round(points * 10) / 10),
    reasons: reasons.slice(0, 4),
  };
}

/**
 * 逐句 AI 味定位
 * @returns {{ index, level, sentences: Array<{text, score, reasons}> }}
 */
export function locateAiFlavor(text) {
  const body = String(text || '');
  const rawSentences = body.match(SENTENCE_RE) || [];
  const sentences = rawSentences
    .map((s) => s.trim())
    .filter((s) => s.length > 6);

  const scored = sentences.map((s) => {
    const { score, reasons } = scoreSentence(s);
    return { text: s, score, reasons };
  });

  const problemSentences = scored.filter((s) => s.score >= 1.5);
  const totalPoints = scored.reduce((a, s) => a + s.score, 0);
  const maxScore = Math.max(0, 10 - totalPoints / Math.max(1, scored.length));
  const index = Math.round(Math.min(10, Math.max(0, maxScore)) * 10) / 10;

  const level = index >= 8.5 ? '轻' : index >= 7 ? '中' : index >= 5.5 ? '重' : '严重';

  return {
    index,
    level,
    sentenceCount: scored.length,
    problemCount: problemSentences.length,
    sentences: scored.sort((a, b) => b.score - a.score).slice(0, 30),
  };
}
