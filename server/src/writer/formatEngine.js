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
  // 保护系统面板【...】块和引号内内容：不断句（先替换为占位符，最后还原）
  // 引号保护防"定位红点已经和“观察者：0”。重叠"这类把引号内标识切断的错误
  const blocks = [];
  out = out.replace(/【[^】]{1,260}】|“[^”]{1,120}”|‘[^’]{1,120}’|「[^」]{1,120}」|『[^』]{1,120}』/g, (b) => {
    blocks.push(b);
    return `§BLOCK${blocks.length - 1}§`;
  });
  // 匹配一段连续无标点中文（长度 >= 20），在其后半段找自然断点补句号
  const re = /[一-龥]{20,}/g;
  out = out.replace(re, (run) => {
    if (run.length < 20) return run;
    // 第一优先级：感官名词后断（气/光/声/味/色/香/影——名词短语自然结束点）
    // 第二优先级：方位/副词后断（里/处/边/后/地/就/还/也/又）
    const breakAt = (() => {
      for (let i = 12; i < run.length - 4; i += 1) {
        const c = run[i];
        // 感官名词后断；但避免切断"影子/味儿"等词（后接 子/儿/们 时跳过）
        if ('气光声味色香影'.includes(c)) {
          const next = run[i + 1] || '';
          if ('子儿们'.includes(next)) continue;
          return i + 1;
        }
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
  // 还原系统面板
  out = out.replace(/§BLOCK(\d+)§/g, (_, i) => blocks[Number(i)]);
  return out;
}

/** 通用断句/分段 cues，不绑定具体书名角色 */
export function applyLocalFormatPass(text, extraCues = []) {
  let normalized = String(text || '')
    .replace(/([一-龥])\.(?=[一-龥])/gu, '$1。')
    .replace(/【([^】]+)】(?=[一-龥])/gu, '【$1】\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 引号外多余句号清理：仅当引号内是"标识符风格"（含冒号/数字，如"观察者：0"）且引号后紧接中文时，
  // 删除引号后的孤立句号，避免"“观察者：0”。重叠"被切成两段（系统标识应视为整体）
  normalized = normalized.replace(/“[^”\n]{1,40}[:：][^”\n]{0,30}”。(?=[一-龥])/gu, (m) => m.slice(0, -1));

  // 保护"标识符引号"块（如"观察者：0"）：内容含冒号/数字，视为整体，不被后续分段规则切开
  const idQuotes = [];
  normalized = normalized.replace(/“[^”\n]{1,40}[:：][^”\n]{0,30}”/g, (q) => {
    idQuotes.push(q);
    return `§IDQ${idQuotes.length - 1}§`;
  });

  const genericCues = [
    '但', '可', '而', '忽然', '突然', '这时', '下一秒', '片刻后', '随后', '紧接着', '与此同时',
    ...extraCues,
  ];
  normalized = splitLongRuns(normalized, genericCues);
  normalized = hardBreakUnpunctuatedRuns(normalized);

  normalized = normalized
    .replace(/([】”’」』])(?=[“‘「『一-龥])/gu, '$1\n\n')
    .replace(/([。！？!?…])(?=[“‘「『【一-龥])/gu, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 标识符引号是句子成分：删除其后被分段规则切出的换行，让标识符与谓语/补语相连
  // （如"定位红点已经和“观察者：0”\n\n重叠" → "定位红点已经和“观察者：0”重叠"）
  normalized = normalized.replace(/§IDQ(\d+)§\n{2,}(?=[一-龥])/g, (_, i) => `§IDQ${i}§`);

  // 还原标识符引号
  normalized = normalized.replace(/§IDQ(\d+)§/g, (_, i) => idQuotes[Number(i)]);
  return normalized;
}
