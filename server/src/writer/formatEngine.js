/**
 * 确定性格式引擎：在调用 LLM 标点修复前尽量本地修好
 */

function splitLongRuns(text, cues) {
  let out = text || '';
  for (const cue of cues) {
    const re = new RegExp(`([^。！？!?…\\n]{20,})(${cue})`, 'gu');
    out = out.replace(re, '$1。$2');
  }
  return out;
}

/**
 * 硬断句：无标点 run 超阈值时在语义边界断开（确定性，不调用 LLM）
 * 在 cue 断句之外的兜底：直接把超过 24 字无标点的 run 按 16-20 字切分补标点
 */
function hardBreakUnpunctuatedRuns(text) {
  let out = String(text || '');
  // 匹配一段连续无标点中文（长度 >= 20），在其后半段找自然断点补句号
  const re = /[一-龥]{20,}/g;
  return out.replace(re, (run) => {
    if (run.length < 20) return run;
    // 第一优先级：感官名词后断（气/光/声/味/色/香/影——名词短语自然结束点）
    // 第二优先级：方位/副词后断（里/处/边/后/地/就/还/也/又）
    const breakAt = (() => {
      for (let i = 12; i < run.length - 4; i += 1) {
        const c = run[i];
        if ('气光声味色香影'.includes(c)) return i + 1;
      }
      for (let i = 10; i < run.length - 4; i += 1) {
        const c = run[i];
        if ('里处边后地就还也又'.includes(c)) return i + 1;
      }
      return Math.floor(run.length * 0.6);
    })();
    const head = run.slice(0, breakAt);
    const rest = run.slice(breakAt);
    return head + '。' + hardBreakUnpunctuatedRuns(rest);
  });
}

/** 通用断句/分段 cues，不绑定具体书名角色 */
export function applyLocalFormatPass(text, extraCues = []) {
  let normalized = String(text || '')
    .replace(/([一-龥])\.(?=[一-龥])/gu, '$1。')
    .replace(/【([^】]+)】(?=[一-龥])/gu, '【$1】\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const genericCues = [
    '但', '可', '而', '忽然', '突然', '这时', '下一秒', '片刻后', '随后', '紧接着', '与此同时',
    ...extraCues,
  ];
  normalized = splitLongRuns(normalized, genericCues);
  normalized = hardBreakUnpunctuatedRuns(normalized);

  return normalized
    .replace(/([】”’」』])(?=[“‘「『一-龥])/gu, '$1\n\n')
    .replace(/([。！？!?…])(?=[“‘「『【一-龥])/gu, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
