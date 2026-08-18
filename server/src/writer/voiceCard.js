/**
 * 主角/作品口吻卡：注入写章与润稿 prompt，统一「人味」与声线
 */

export const LINZHAO_VOICE_CARD = `【主角口吻卡：林照】
- 说话懒、短句为主，能少字就少字；爱吐槽但不给读者上科普课。
- 紧张时先嘴硬、先敷衍，再慢半拍反应过来；少写惊慌大叫、少堆心理形容词。
- 情绪用动作写：扯嘴角、翻白眼、扣手机、先吃/先睡/先不管；禁止「不是笑也不是气而是那种……」对照句。
- 对系统/天道/直播：当骚扰推送处理——可无视、可反问、可摆烂，不当圣旨念，不帮读者总结规则。
- 弹幕/热搜：每处最多写 1-2 条最有代表性的，禁止刷屏式罗列。
- 禁止作者腔：总之、显然、值得一提的是、深入探讨、莫名感到、不禁、宛如。
- 对白示例：「哦。」「行啊。」「也挺好。」「关我什么事。」「先睡。」
- 内心示例：具体念头（面还热着 / 明天还得去送死 / 保温杯里泡枸杞）而非感慨式独白。`;

export const GENERIC_VOICE_CARD_HINT = `【口吻通用要求】
- 对话像真人说话：有停顿、有省略、有口癖，信息拆成 2-3 句，不要一句塞三层转折。
- 叙述先写可见动作和环境反馈，再写判断；少用「他感到」「一股……涌上心头」。
- 每章至少 2 处只有这个主角才会有的反应（懒、损、怂、硬撑等），让读者记住是谁在说话。`;

/** 是否为《摆烂/林照》本书，用于自动挂载口吻卡 */
export function detectLinZhaoBook(topic = '', setting = '') {
  const text = `${topic}\n${setting}`;
  return /林照|摆烂|天道漏洞|天道直播/u.test(text);
}

/**
 * 解析最终口吻卡：项目自定义 > 自动识别林照 > 空
 */
export function resolveVoiceCard({ voiceCard, topic, setting } = {}) {
  const custom = String(voiceCard || '').trim();
  if (custom) return custom;
  if (detectLinZhaoBook(topic, setting)) return LINZHAO_VOICE_CARD;
  return '';
}

/** 关键章额外强调人味与钩子 */
export const KEY_CHAPTER_NUMBERS = [1, 3, 10, 30, 50, 100, 150, 200, 300, 400, 500, 620];

export function buildKeyChapterHint(chapterNumber, { topic, setting } = {}) {
  if (!KEY_CHAPTER_NUMBERS.includes(Number(chapterNumber))) return '';
  const linzhao = detectLinZhaoBook(topic, setting);
  const who = linzhao ? '林照' : '主角';
  if (chapterNumber === 1) {
    return `【关键章·开篇】第一屏必须有人味：${who}的反应要具体、要懒、要好笑或要欠，禁止说明书式世界观铺陈。`;
  }
  if ([50, 100, 150, 200, 300, 400, 500].includes(chapterNumber)) {
    return `【关键章·第${chapterNumber}章】卷级节点：加强情绪落点与章尾钩子，${who}口吻不能丢。`;
  }
  return `【关键章·第${chapterNumber}章】加强人味与章尾追读，${who}说话保持短句、嘴硬、具体。`;
}

export function formatVoiceSection(voiceCard) {
  const card = String(voiceCard || '').trim();
  if (!card) return '';
  return `${card}\n\n${GENERIC_VOICE_CARD_HINT}`;
}
