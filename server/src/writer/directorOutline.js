/**
 * 导演式顶层大纲（Director Outline）
 * 以「导演思维」做全书顶层规划：卖点承诺 → 分卷蓝图 → 爽点节奏 → 伏笔网络 → 人物弧光 → 结局方案
 * 再由顶层大纲生成每章细纲（目标/阻碍/爽点/章尾钩/伏笔操作），写章时注入 prompt。
 */
import { trimToCharLimit } from '../llm/contextLimit.js'

/**
 * 生成全书「导演大纲」
 * @param {object} opts { novelSetting, topic, genre, numChapters, wordPerChapter, existingDirectory }
 */
export function buildDirectorOutlinePrompt(opts = {}) {
  const { novelSetting, topic, genre, numChapters = 200, wordPerChapter = 2000, existingDirectory } = opts;
  const totalWords = numChapters * wordPerChapter;
  const volumes = Math.max(1, Math.ceil(numChapters / 50));
  return `你是顶级的网文主编，同时具备导演思维：像拍一部连续剧一样规划整本小说的顶层结构。请基于设定输出《导演大纲》，用简洁条目，不要大段废话。

【小说设定】
${trimToCharLimit(novelSetting || '（无）', 6000)}

${existingDirectory ? `【现有章节目录（前几卷，可参考其章节安排）】\n${trimToCharLimit(existingDirectory, 3000)}\n` : ''}

【规模】全书约 ${numChapters} 章 / ${(totalWords / 10000).toFixed(0)} 万字，每章约 ${wordPerChapter} 字，分约 ${volumes} 卷。

【输出格式】

## 一、卖点与读者承诺
一句话卖点（简介用）+ 3 条读者承诺（读者追这本书能得到什么：爽、悬念、情绪、知识……逐条说清在哪类章节兑现）。

## 二、开篇方案（黄金三章）
- 第 1 章钩子设计（第一句/前 300 字写什么，具体到画面）
- 金手指上线章与方式
- 前三章每个的章尾钩
- 前三章要达成的三个目标（立人设/立冲突/立悬念）

## 三、分卷蓝图（每卷约 50 章，共 ${volumes} 卷）
每卷输出：
- 卷名与卷主题（一句话）
- 本卷起-承-转-合（各 1 句：开篇状态→冲突升级→转折→卷尾收束）
- 卷内爽点高峰位置（第 X 章小爽点、第 Y 章大爽点、卷尾爆点）
- 卷尾钩（本卷结束时的最大悬念）
- 情绪曲线（本卷从什么情绪到什么情绪，如：憋屈→上扬→爆发→余韵）

## 四、爽点节奏表（全书）
按「每 3-5 章小爽点、每 10-15 章中爽点、每卷一次大爆点」规划，列出：章号区间 + 爽点类型（打脸/升级/揭秘/救人/逆袭/收获）+ 具体内容。

## 五、伏笔网络
列出核心伏笔（5-10 个）：伏笔内容 + 埋设章 + 回收章 + 类型（身份/真相/旧案/人物/规则）。要求：伏笔间距合理，回收必须交代，禁止挖了不填。

## 六、人物弧光节点
每个核心角色：起始状态 → 第几章发生什么转折 → 最终状态。至少覆盖主角与反派。

## 七、结局方案
结局类型（大团圆/开放式/反转式/悲剧式）+ 最后 30 章的收束计划（主线、伏笔、情绪曲线如何收）+

## 八、风险自查
列出本书最可能扑街的 3 个点 + 对应的开播前规避方案。

仅输出《导演大纲》正文，不要「好的」「以下是」等前缀。`;
}

/**
 * 生成单章「细纲」（目标/阻碍/爽点/章尾钩/伏笔操作）
 * @param {object} opts { directorOutline, novelSetting, chapterNumber, title, chapterRole, chapterPurpose, chapterSummary, volumeIndex }
 */
export function buildChapterOutlinePrompt(opts = {}) {
  const { directorOutline, novelSetting, chapterNumber, title, chapterRole, chapterPurpose, chapterSummary, volumeIndex } = opts;
  return `你是执行导演。请根据《导演大纲》和本章目录信息，产出第 ${chapterNumber} 章的「执行细纲」，用于指导正文写作。输出简洁条目。

【导演大纲（全书顶层规划）】
${trimToCharLimit(directorOutline || '（无）', 6000)}

【小说设定（要点）】
${trimToCharLimit(novelSetting || '（无）', 3000)}

【本章目录信息】第 ${chapterNumber} 章《${title || '无题'}》${volumeIndex ? `（第 ${volumeIndex} 卷）` : ''}
本章定位：${chapterRole || ''}
核心作用：${chapterPurpose || ''}
本章简述：${chapterSummary || ''}

【输出格式】
- 本章目标：1 句话（本章推进什么）
- 开场钩：前 300 字的具体画面设计（从什么切入，第一句写什么）
- 三段推进：① 开头段（承接上章/立目标）② 中段（阻碍/冲突/转折）③ 收尾段（反馈/反转）
- 本章爽点：写什么（若本章是过渡章，写"无爽点，但必须埋一个即将兑现的期待"）
- 章尾钩：具体写什么（用哪种钩：悬念/危机/反转/打脸预告/关系/升级/信息/倒计时）
- 伏笔操作：埋设/推进/回收哪个伏笔，具体到内容
- 人设细节：本章给主角/配角一个真人感细节（口癖、习惯动作、私货吐槽点）
- 字数分配：开场钩（约 300 字）/ 推进（约 X 字）/ 收尾钩（约 200 字）的分配建议

仅输出细纲正文，不要前缀。`;
}

/**
 * 将细纲注入章节 prompt 的格式化片段
 */
export function formatChapterOutlineSection(chapterOutline) {
  if (!chapterOutline) return '';
  return `【本章执行细纲】（严格按此推进，但正文要写成完整的场景，不要写成梗概）\n${chapterOutline}`;
}
