/**
 * 提示词：吸收 AI_NovelGenerator 的雪花法、目录节奏、前文摘要与角色状态
 * 保持「去 AI 味」网文风格
 * 上下文长度对齐 DeepSeek 128K，各字段按预算截断，避免突破上限并留出输出空间
 */
import { trimToCharLimit } from '../llm/contextLimit.js'
import { FIELD_CAPS as CAP } from '../llm/contextBudget.js'
import { formatVoiceSection, buildKeyChapterHint } from './voiceCard.js'
import { formatChapterOutlineSection } from './directorOutline.js'

export const SYSTEM_PROMPT = `你是一位成熟的番茄小说签约作者，文风老练，节奏把控强，擅长悬念、爽点和情绪张力。
写作要求：
1. 用词口语化、有网文感，避免书面腔和论文式句子；读者下沉，短句为主，少大段心理描写。
2. 句子长短错落，短句干脆，长句只在需要氛围时用；少用「首先、其次、总之」等套路。
3. 对话要有人味，符合角色身份和当下情绪；动作与神态描写具体，不堆形容词。
4. 每段信息密度高，少废话；情节推进利落，该留白留白，该爆发爆发。
5. 禁止使用：众所周知、值得注意的是、可以说、毋庸置疑、深入探讨、他/她心想、一股……的感觉 等 AI 常用表达。
6. 直接进入场景和冲突，不要开场大段解释或背景科普；开头 300 字内必须抛出钩子：困境、冲突、危机、利益点、反转。
7. 必须使用规范中文标点和自然分段，避免连续 24 字以上没有逗号、句号、问号或感叹号；单段尽量控制在 80-180 字。
8. 系统面板、任务提示、弹幕提示等形如【...】的内容必须单独成行，不要在】前后追加标点；不要使用 Markdown 加粗符号 **。
9. 连载写作以“前文摘要、角色状态、上一章结尾、道具状态、规则边界”为硬事实；不能为了推进剧情让重伤者突然灵活行动、让道具无交代消失/出现、让失效系统正常播报、让历史年代/文字/官制互相打架。
10. 克制 AI 腔：少用「不是……而是……」「不是……也不是……而是……」这类对照句，尤其不要用来写笑、哭、眼神、语气、感觉；少堆省略号、破折号、重复感叹号；多用动作、停顿、视线和细节来表现情绪。
11. 情绪要“演”出来，不要“喊”出来：愤怒写“拳头攥得咯咯响、指节发白”，不写“他很愤怒”；难过写“扯了扯嘴角，挤出一个笑”，不写“我很伤心”。用神态、小动作、生理反应、对话潜台词、留白五条通道中的 1-2 个具体细节，不堆比喻。
12. 禁无缘无故的修辞：一段最多一个比喻且必须服务情绪/画面；删掉“为了好看”的排比和叠喻；爽文优先具体动作和细节。
13. 禁极端词和空泛升华：删掉九成“非常、极其、无比、十分、特别、巨大”，用具体画面代替；删掉“生活总是……”“人生就是如此”这类强行升华。
14. 标点规范：对话一律用弯双引号“”，嵌套用弯单引号‘’；不用直角引号「」『』和英文直引号；破折号——一章最多一次；省略号用……（不用...和。。。）；并列用顿号、，不用句号切碎；正文不用✦✨◆★等装饰符号。
15. 禁止语病：写完每句自查一遍是否通顺。特别禁止：①搭配错误如“觉得还没睡”（应为“还没睡醒”）；②虚词叠字“他他”“了了”“是是”“就就”；③一句话里“感觉…感觉”“觉得…觉得”重复；④主谓宾残缺、语义矛盾、词性误用。宁可短句拆开，不要写出病句。
16. 真实语域：所有工具、名词、行话必须来自真实世界，禁止发明词。外卖员用「手机」（不是“接单器”）、接单用「接单软件/APP/平台」；平台规则用真实行话：「超时」「差评」「申诉」「转单」（不是“转卖”）「取消订单」「送达」「骑手」。系统面板内容必须是现实中说得通的话，禁止“且不。可转卖”这类断裂或书面腔。写“系统提示/规则条文”时，想象它是真实的 APP 弹窗，读起来像真的一样。
17. 人味/失控感：关键处让角色做“逻辑上不该、情绪上必须”的事（明知会输还赌、当场翻脸不解释）；情绪可以不说完（“他没说完那句话。”）；次要的事允许不解释尽。点睛不发疯，不牺牲节奏和爽点。`;

const TOMATO_HOOK_RULES = `【番茄黄金 300 字公式】（开头定生死）
- 公式：开局低谷 + 强冲突 + 金手指 + 钩子。
- 第一句直给困境（被弃/被追杀/被绿/病危/葬礼/绑定系统），零铺垫。
- 300 字内引爆冲突（打脸/背叛/生死危机/异常事件）。
- 第 1000 字前必须出现第一次小爽点（被羞辱→亮底牌、危机→转机、被看扁→露一手）。
- 开头四禁忌：❌慢热铺垫(写景/回忆/背景) ❌大段设定(世界观/等级) ❌多人扎堆(开篇≤3人) ❌长段落(手机阅读窒息)。

【章尾钩】（断章艺术，一章一钩）
- 每章结尾必须留一个“未完成”，严禁在情绪最高点收尾——要在“即将揭晓/即将爆发”的前一秒断。
- 八种章尾钩任选：悬念钩(抛出谜题不解答)、危机钩(危险降临未化解)、反转钩(真相即将颠覆)、打脸预告钩(嘲讽者即将翻车)、关系钩(情感即将质变)、升级钩(实力/资源即将跃迁)、信息钩(关键情报半遮半掩)、倒计时钩(给出明确时限)。
- 钩要兑现：埋的钩必须在 1-3 章内回收，否则读者弃书；大钩套小钩（卷级悬念下挂章级悬念）。

【爽点】（网文的命脉）
- 三段式闭环：压抑(把不公/嘲讽/危机写具体) → 蓄势(主角隐忍/布局/觉醒) → 释放(打脸/翻盘/碾压写足)。
- 打脸四拍：①嘲讽(反派/众人看不起主角，越嚣张越好) ②沉默(主角不辩解，淡淡出手) ③碾压(实力/真相一击致命) ④围观(旁观者震惊反应——最容易漏，但最爽)。
- 爽点必须升级：不能原地重复，要升级对象/规模/方式（打脸同窗→长辈→宗门→天才→大势力）。
- 全程高频爽点，不能长时间憋屈；过渡章也要推进局势。`;

const TOMATO_RHYTHM_RULES = `【句式节奏】（像人写的，不像流水线）
- 句长不均匀：短句与长句交错，该短就一两个字成句，该长就一口气写长句；避免每句长度差不多——整齐=AI。
- 用停顿做呼吸：省略号拖一下、破折号转折、单句成段制造重音；但都是调味，别每句都用。
- 情绪不说完/话说一半：“他张了张嘴，最后什么也没说。”“她想解释，可是……算了。”
- 节奏配情绪：紧张/爆发用短句碎句砸下来，舒缓/回忆用长句铺一铺，紧-缓-紧交替，别一个节奏到底。
- 段落长短交错：上下两段字数行数雷同、结构镜像=机器排的；故意打破对称。
- 番茄快节奏仍以短句为主，长句少而精地穿插。`;

const CONTINUITY_HARD_RULES = `【连续性硬规则】
- 前文摘要、当前角色状态、上一章结尾是硬锚点；本章只能顺着写，不能改写成相反事实。
- 角色若处于重伤、濒死、侵蚀、昏迷、失力状态，只能写低强度反应，例如睁眼、喘息、短句、被搀扶、被拖动、极短距离挪动；除非正文先给出明确治疗/借力/代价，否则不能主动奔跑、爬行、战斗或完成复杂动作。
- 道具、食物、武器、钥匙、石碑、符箓等必须有连续归属；不能无交代掉落、消失、重新出现或换人持有。需要改变状态时，必须在正文里写出动作过程。
- 角色认知有边界。知道什么、不知道什么、是否深度融入某段记忆，都要与前文一致；如果需要弱化矛盾，写成“没亲眼见过”“只听过残片”“记忆被遮蔽”，不要直接写成完全不知道。
- 规则源必须清楚。若前文写明系统失效、受干扰或提示不可直接信任，本章不得写成正常系统播报；只能写未知信号、残留规则、伪装提示、山河记忆回声，并在叙述中点明不可信。
- 历史年代、文字、官制、器物不能混用。拿不准时写成“残缺古字”“旧刻痕”“风化铭文”，不要强行指定秦篆、唐代年号等互相矛盾的细节。
- 修复矛盾优先级：先删冲突动作；再把动作降级；再补一句已有规则内的解释；最后才微调描写。不要新增大设定来补洞。`;

const STYLE_HARD_RULES = `【表达硬规则】
- 克制省略号、破折号、连续感叹号。单章省略号尽量少于 8 处；能用动作、短句、停顿表达，就不要满篇“……”。
- 少用「不是……而是……」「不是……也不是……而是……」等模板对照句，尤其不要反复用于描写笑、怒、慌、眼神、声音、姿态、感觉。
- 对话要像人在说话。别把三四层信息硬塞进一句引号里；需要转折、停顿、追问时，请拆成两到三句。
- 叙述优先写可见动作、环境反馈、身体反应，再落到情绪判断；不要反复用抽象词直接宣布人物在“震惊、恐惧、压抑、绝望”。
- 禁止把完整词语切开插标点，例如“一。条缝”“浑浊的。眼睛”“明！白了”。标点只能落在自然语义边界。
- 禁止语病：每句写完自查通顺。不得出现“觉得还没睡”（应为“还没睡醒”）、“他他”“了了”等虚词叠字、“感觉…感觉”“觉得…觉得”重复、主谓宾残缺或语义矛盾。宁可拆成短句，不写病句。`;

const FANQIE_READABILITY_RULES = `【平台可读性规则（番茄 9.0 档追读标准）】
- 第一屏 400 字内必须给出钩子：异常、危机、任务、利益点、反转、冲突，至少命中一种；禁止先铺两三段背景再进入正题。
- 每章必须完成「小目标 → 阻碍 → 反馈/反转 → 章尾钩子」四步中的至少三步；过渡章也要推进局势，不能只做气氛展示。
- 少解释，多呈现。信息通过对话、动作、场景压力、弹幕/系统反馈带出，禁止作者总结腔。
- 手机端阅读优先：单段 3-5 行阅读感；对话切换、动作转折、信息揭露处必须分段，禁止文字墙。
- 章尾最后 2-3 段必须留下未解问题、即将发生的变故、新风险或明确选择，让读者有理由点下一章。
- 爽点、悬念、危机落到具体事件，不堆抽象感受；文风通俗利落，读者一眼看懂「发生了什么、主角要什么、卡在哪里」。
- 前三章必须打脸+身份反转，金手指最晚第 1 章末上线；读者对慢热容忍极低。`;
// ========== Step1 生成设定（核心种子 + 角色 + 世界观 + 情节架构 + 长篇总纲） ==========
export function buildSettingPrompt(topic, genre, numChapters, wordPerChapter) {
  const totalWords = (numChapters || 20) * (wordPerChapter || 2000)
  const isLong = (numChapters || 0) > 80
  const volumeHint = isLong
    ? `\n## 全书总纲（分卷梗概）\n本书为超长篇（约 ${numChapters} 章、${(totalWords / 10000).toFixed(0)} 万字），请按「卷」划分：每约 50 章为一卷，写出每一卷的一句话梗概（本卷核心冲突/转折/结局走向），便于长篇连载不跑偏。格式：卷1：[梗概]；卷2：[梗概]；…`
    : ''
  return `请为一部长篇小说生成「小说设定」文档，包含以下部分，用简洁条目，不要大段叙述。

【输入】
主题/点子：${topic || '未指定'}
类型：${genre || '都市'}
篇幅：约 ${numChapters || 20} 章，每章约 ${wordPerChapter || 2000} 字（合计约 ${(totalWords / 10000).toFixed(0)} 万字）。

【输出格式】

## 核心种子（一句话概括故事本质）
用单句公式，例如：「当[主角]遭遇[核心事件]，必须[关键行动]，否则[灾难后果]；与此同时，[隐藏的更大危机]正在发酵。」25–100字。

## 核心角色（3–5人）
每个角色：姓名、身份、与主角关系、性格关键词、表面目标/深层渴望、与至少一名其他角色的冲突或纽带。条目化。

## 世界观要点
物理/社会/规则层面各 2–3 条可引发冲突的设定（如权力断层、禁忌、资源争夺）。

## 情节架构（三幕）
- 第一幕（触发）：日常异常、打破平衡的事件、主角的错误抉择。
- 第二幕（对抗）：主线升级、虚假胜利、灵魂黑夜。
- 第三幕（解决）：代价、转折、余波与开放式悬念。
${volumeHint}

仅输出设定正文，不要「好的」「以下是」等前缀。`;
}

const MAX_CHAPTERS_PER_SEGMENT = 20;

// ========== Step2 生成章节目录（支持按批生成，单次最多 20 章保证质量与上下文） ==========
export function buildDirectoryPrompt(novelSetting, numChapters, options = {}) {
  const { volumeStart, volumeEnd, previousVolumeSummary } = options;
  const isSegment = typeof volumeStart === 'number' && typeof volumeEnd === 'number';
  let from = isSegment ? volumeStart : 1;
  let to = isSegment ? volumeEnd : (numChapters || 20);
  if (isSegment && to - from + 1 > MAX_CHAPTERS_PER_SEGMENT) {
    to = from + MAX_CHAPTERS_PER_SEGMENT - 1;
  }
  const segmentHint = isSegment
    ? `
【重要：本段分卷目录】
你必须且仅生成第 ${from} 章到第 ${to} 章，共 ${to - from + 1} 章。不得少写一章、不得多写、不得合并章节。
每章必须包含以下 5 行，格式严格一致：
  第N章 - [标题]
  本章定位：[内容]
  核心作用：[内容]
  悬念密度：[紧凑/渐进/缓冲]
  本章简述：[一句话，50字内]
严禁把「本章定位 / 核心作用 / 悬念密度 / 本章简述」挤在同一行；严禁从中途改成单行格式；严禁写成「本定位」「核心用」「章节简」等缩写。

${previousVolumeSummary ? `【上一段目录结尾（请从第 ${from} 章紧接其后，风格与格式与下例一致）】\n${trimToCharLimit(previousVolumeSummary, CAP.previousVolumeSummary)}\n\n【请从第 ${from} 章开始逐章生成到第 ${to} 章】` : `请从第 ${from} 章开始逐章生成到第 ${to} 章。`}
`
    : '';
  const endHint = to >= (numChapters || 20) ? '在到达最后一章之前不要写结局章。' : '本段为中间卷，不要写全书结局。';
  return `根据以下小说设定，生成章节目录。

【小说设定】
${trimToCharLimit(novelSetting || '（无）', CAP.novelSetting)}
${segmentHint}

【要求】
- 本段共 ${to - from + 1} 章（第 ${from} 章～第 ${to} 章），每章格式如下。
- 格式：第N章 - [标题]
本章定位：[角色/事件/主题]
核心作用：[推进/转折/揭示/铺垫…]
悬念密度：[紧凑/渐进/缓冲]
本章简述：[一句话概括，50字内]
- 每一章必须刚好 5 行；如果输出到后半段也必须保持同样格式，不得压缩成「第N章 - 标题。本定位……」这种一行格式，不得使用字段缩写。

- 节奏：每 3–5 章一个小高潮。${endHint}
仅输出目录正文，不要解释。`;
}

// ========== Step2 修正：格式/缺章时让 AI 重出 ==========
export function buildDirectoryFixPrompt(errors, invalidContent, volumeStart, volumeEnd) {
  return `你之前生成的「第 ${volumeStart} 章～第 ${volumeEnd} 章」目录经检查有以下问题，请直接输出修正后的完整目录（仅正文，不要解释）：

【检查出的问题】
${errors.map((e) => `- ${e}`).join('\n')}

【你之前输出的内容（有误）】
---
${trimToCharLimit(invalidContent || '', CAP.invalidContent)}
---

【修正要求】
1. 必须包含且仅包含第 ${volumeStart} 章到第 ${volumeEnd} 章，每章 5 行格式：
   第N章 - [标题]
   本章定位：[内容]
   核心作用：[内容]
   悬念密度：[紧凑/渐进/缓冲]
   本章简述：[一句话，50字内]
2. 每一章之间空一行；每个字段独占一行，绝对不要把多个字段写成一行，字段名必须完整写作「本章定位」「核心作用」「悬念密度」「本章简述」。
3. 补全缺失的章节，删除多余或重复的章节，修正格式错误。
4. 直接输出修正后的完整目录，不要任何前缀或说明。`;
}

// ========== Step3 章节正文（首章 vs 后续章） ==========
export function buildFirstChapterPrompt(opts) {
  const { title, chapterRole, chapterPurpose, chapterSummary, novelSetting, wordNumber = 2000, userGuidance, voiceCard, topic, chapterOutline, abilitySection, foreshadowSection, characterProfilesSection, patternsSection, lessonsSection } = opts;
  const minWordNumber = Math.floor((wordNumber || 2000) * 0.96);
  const voiceSection = formatVoiceSection(voiceCard);
  const keyHint = buildKeyChapterHint(1, { topic: opts.topic, setting: novelSetting });
  const outlineSection = formatChapterOutlineSection(chapterOutline);
  return `即将创作：第 1 章《${title || '无题'}》
本章定位：${chapterRole || '开场'}
核心作用：${chapterPurpose || '引入'}
本章简述：${chapterSummary || '无'}

【小说设定】
${trimToCharLimit(novelSetting || '（无）', CAP.novelSetting)}

${voiceSection ? `${voiceSection}\n\n` : ''}${CONTINUITY_HARD_RULES}

${STYLE_HARD_RULES}

${TOMATO_HOOK_RULES}

${FANQIE_READABILITY_RULES}

${TOMATO_RHYTHM_RULES}

${outlineSection ? `${outlineSection}\n\n` : ''}${abilitySection ? `${abilitySection}\n\n` : ''}${foreshadowSection ? `${foreshadowSection}\n\n` : ''}${characterProfilesSection ? `${characterProfilesSection}\n\n` : ''}${patternsSection ? `${patternsSection}\n\n` : ''}${lessonsSection ? `${lessonsSection}\n\n` : ''}
请完成第 1 章正文，约 ${wordNumber} 字，最低不少于 ${minWordNumber} 字；未写够前不要收尾。要求：
- 黄金第一段：前 3 句内制造一个信息差 + 危机/反差（参考结构：悬置危机/身份反差/结局倒挂/金手指激活/日常爆破），让读者必须往下看。
- 第 300 字内引爆冲突；本章末前亮出金手指（系统/重生/异能/祖传宝物等），并留章尾钩。
- 至少包含：一段有张力的对话、一段动作或环境描写、可延续的悬念或伏笔。
- 本章内部必须形成“目标、阻碍、反馈、章尾钩子”四步中的至少三步。
- 不要提前收尾，不要只写剧情梗概；必须把动作、对话、环境压力和人物反应写成完整场景。
- 使用规范中文标点与自然分段，情绪爆发也要有清晰断句，不要连续 24 字以上无标点，不要输出整段无标点长句。
- 系统面板、任务提示等【...】内容必须单独成行，不要在】前后追加标点；不要使用 Markdown 加粗符号 **。
- 仅返回正文，不要章节标题、Markdown、作者说。${keyHint ? `\n\n${keyHint}` : ''}${userGuidance ? `\n\n本章指导：${userGuidance}` : ''}`;
}

export function buildNextChapterPrompt(opts) {
  const {
    novelNumber, title, chapterRole, chapterPurpose, chapterSummary,
    globalSummary, previousExcerpt, characterState, outlineWindow, novelSetting,
    nextChapterTitle, nextChapterSummary,
    wordNumber = 2000, userGuidance, voiceCard, topic, chapterOutline, abilitySection, foreshadowSection, characterProfilesSection, patternsSection, lessonsSection,
  } = opts;
  const minWordNumber = Math.floor((wordNumber || 2000) * 0.96);
  const voiceSection = formatVoiceSection(voiceCard);
  const keyHint = buildKeyChapterHint(novelNumber, { topic: opts.topic, setting: novelSetting });
  const outlineSection = formatChapterOutlineSection(chapterOutline);
  const parts = [
    '【前文摘要】',
    trimToCharLimit(globalSummary || '（暂无）', CAP.globalSummary),
    '',
    '【上一章结尾段】（请紧接氛围与节奏）',
    trimToCharLimit(previousExcerpt || '（无）', CAP.previousExcerpt, { fromEnd: false }),
    '',
    characterState ? `【当前角色状态】\n${trimToCharLimit(characterState, CAP.characterState)}` : '',
    '',
    outlineWindow ? `【附近章节大纲（保持当前章节只写当前内容，不要越界剧透）】\n${trimToCharLimit(outlineWindow, CAP.outlineWindow)}` : '',
    '',
    `【当前章节】第 ${novelNumber} 章《${title || '无题'}》`,
    `本章定位：${chapterRole || ''}`,
    `核心作用：${chapterPurpose || ''}`,
    `本章简述：${chapterSummary || ''}`,
    '',
    nextChapterTitle ? `【下一章】第 ${novelNumber + 1} 章《${nextChapterTitle}》\n${nextChapterSummary || ''}` : '',
    '',
    `【小说设定】（供参考）\n${trimToCharLimit(novelSetting || '', CAP.novelSettingShort)}`,
    '',
    CONTINUITY_HARD_RULES,
    '',
    STYLE_HARD_RULES,
    '',
    TOMATO_HOOK_RULES,
    '',
    FANQIE_READABILITY_RULES,
    '',
    TOMATO_RHYTHM_RULES,
    '',
    voiceSection || '',
    '',
    outlineSection || '',
    '',
    abilitySection || '',
    '',
    foreshadowSection || '',
    '',
    characterProfilesSection || '',
    '',
    patternsSection || '',
    '',
    lessonsSection || '',
    '',
    `请完成第 ${novelNumber} 章正文，约 ${wordNumber} 字，最低不少于 ${minWordNumber} 字；未写够前不要收尾。内容需与前文摘要、上章结尾衔接流畅，并为下一章留出空间。不要提前收尾，不要只写剧情梗概；必须把动作、对话、环境压力、系统/弹幕反应和人物选择写成完整场景。当前章必须有明确推进：至少写出一个可见的小目标、一个阻碍、一个反馈或反转，并在结尾留下下一步钩子——从八种章尾钩中选一种收尾（悬念/危机/反转/打脸预告/关系/升级/信息/倒计时），在“即将揭晓”的前一秒断章。必须使用规范中文标点与自然分段，情绪爆发也要有清晰断句，不要连续 24 字以上无标点，单段尽量控制在 80-180 字。系统面板、任务提示等【...】内容必须单独成行，不要在】前后追加标点；不要使用 Markdown 加粗符号 **。仅返回正文，不要章节标题、Markdown、作者说。${keyHint ? `\n\n${keyHint}` : ''}${userGuidance ? `\n\n本章指导：${userGuidance}` : ''}`,
  ];
  return parts.filter(Boolean).join('\n');
}

export function buildPunctuationRepairPrompt(chapterText) {
  return `下面是一段小说正文，剧情和措辞基本可用，但存在标点缺失、断句过长的问题。

请只做以下处理：
1. 补全中文标点（，。！？；：“”……）。
2. 按语义和节奏自然分段。
3. 不新增剧情，不删除剧情，不改人物名、地点、系统提示、任务内容。
4. 系统面板、任务提示等【...】内容必须单独成行，不要在】前后追加标点；删除 Markdown 加粗符号 **。
5. 不把文本改成总结，不加章节标题，不写解释。

正文如下：
---
${trimToCharLimit(chapterText || '', 12000)}
---

仅返回修正后的正文。`;
}

// ========== Step4 定稿：更新前文摘要 ==========
export function buildSummaryUpdatePrompt(chapterText, currentSummary) {
  return `以下是新完成的章节文本：
---
${trimToCharLimit(chapterText || '', CAP.chapterText)}
---

当前的前文摘要（可为空）：
---
${trimToCharLimit(currentSummary || '（无）', CAP.summary)}
---

请根据本章新增内容，更新前文摘要。要求：
- 保留长期主线、因果、未解伏笔、人物关系变化、关键道具/地点、势力状态，不要只保留最近一章。
- 用「主线进展 / 未解伏笔 / 人物与势力 / 下一章衔接」四段更新；旧信息过多时合并同类项，不要直接删除关键因果。
- 总字数控制在 5000-8000 字以内，宁可压缩表达，也要保住连续性锚点。
仅返回更新后的前文摘要正文，不要解释。`;
}

// ========== Step4 定稿：更新角色状态 ==========
export function buildCharacterStateUpdatePrompt(chapterText, oldCharacterState, initialCharacterDynamics) {
  return `以下是新完成的章节文本：
---
${trimToCharLimit(chapterText || '', CAP.chapterText)}
---

当前的角色状态文档（可为空）：
---
${trimToCharLimit(oldCharacterState || '（无）', CAP.characterState)}
---

角色设定参考（来自小说设定）：
---
${trimToCharLimit(initialCharacterDynamics || '', CAP.initialCharacterDynamics)}
---

请更新角色状态。格式简洁，每个角色包含：物品/能力/身体与心理状态/与其他角色的关系变化/本章触发或加深的事件。新出场角色简要列出；淡出视线的可删。
仅返回更新后的角色状态正文，不要解释。`;
}

// ========== 可选：一致性审校 ==========
export function buildConsistencyCheckPrompt(chapterText, globalSummary, characterState) {
  return `请审校以下「最新章节」与前文是否矛盾。只审剧情、设定、人物状态和道具连续性，不评价文笔。

【前文摘要】
${trimToCharLimit(globalSummary || '', CAP.globalSummary)}

【当前角色状态】
${trimToCharLimit(characterState || '', CAP.characterState)}

【最新章节正文】
${trimToCharLimit(chapterText || '', CAP.chapterTextShort)}

【审校重点】
1. 角色状态：重伤、濒死、侵蚀、昏迷、失力者是否做了不合理动作；能力、关系、心理状态是否前后相反。
2. 道具状态：关键物品、食物、武器、钥匙、石碑、符箓是否无交代掉落、消失、出现、转移。
3. 认知边界：角色知道/不知道的信息，是否与身份、记忆融入程度、前文经历矛盾。
4. 规则来源：系统失效、未知信号、山河记忆、清除程序等来源是否混淆；不可把失效系统写成正常播报。
5. 时间地点与历史细节：时间停滞、每日重置、封闭空间、年代、文字、官制、器物是否互相冲突。
6. 剧情因果：是否靠新增大设定、突然恢复、突然知道来强行推进。

【输出要求】（严格 JSON，不要输出任何其他文字，不要思考过程，不要 Markdown 代码块）
- 只输出 JSON 对象，格式如下：
  {"found": false}
  或
  {"found": true, "issues": [{"item": "矛盾点简述", "conflictWith": "与哪条前文事实冲突", "minimalFix": "最小修复方向"}]}
- 若没有明确矛盾，found 必须为 false。不要把“可解释的留白”当矛盾。`;
}

export function buildStyleRepairPrompt(chapterText, styleIssues, opts = {}) {
  const target = Math.floor((Number(opts.wordNumber) || 2000) * 0.96);
  return `你是长篇网文的出版级润稿编辑。请在不改变剧情、设定、人物关系、道具状态和系统提示的前提下，只修正文风与断句问题，让正文更自然、更像成熟网文作者的成稿。

【待修问题】
${styleIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}

【润稿硬规则】
1. 只输出修订后的章节正文，不要解释，不要标题，不要 Markdown。
2. 不改变事件顺序、因果、人物选择、伤势状态、道具归属、世界规则。
3. 少用或删掉模板句，尤其是「不是……而是……」「不是……也不是……而是……」；改成动作、细节、停顿、视线或短句。
4. 控制省略号、破折号、重复感叹号；一处情绪爆发最多保留一组，不要连着堆。
5. 对话必须像真实说话，信息过多的长引号要拆开；一句里不要连塞三层转折。
6. 不要把词语硬切开插标点，不要制造“一。条缝”“明！白了”这类错误。
7. 保持自然分段与中文标点；避免整段长句和机械排比。手机端阅读优先，尽量整理成短段，遇到对话切换、动作转折、信息揭露时主动分段。
8. 删掉解释腔、总结腔、复述腔，让读者直接看到事件在发生；能用动作和反馈表现，就不要改成作者说明。
9. 章尾若原文已有钩子，要把钩子留住并写得更清楚；不要把悬念润没了。
10. 让语言更贴近成熟男频/脑洞网文成稿：通俗、利落、推进感强，但不要模仿任何具体作者。
11. 目标篇幅不少于 ${target} 字；如果原文已经达标，不要明显压缩。

【章节正文】
${trimToCharLimit(chapterText || '', 12000)}

请直接输出修订后的章节正文。`;
}

export function buildWebnovelSkillReviewPrompt({
  chapterText,
  globalSummary,
  characterState,
  chapterRole,
  chapterPurpose,
  chapterSummary,
  previousExcerpt,
}) {
  return `你是“网文审校 skill”，专门从网文平台读者体验角度审校章节成稿。请按六维诊断，重点参考以下标准：
- 钩子（留人）：开篇 3 句有没有立住危机/反差？每章是否有有效章尾钩？钩子是否在“即将揭晓”处断章？
- 爽点（追读）：爽点密度是否匹配番茄（每章至少一个有效爽点）？是否原地重复没升级？打脸四拍（嘲讽→沉默→碾压→围观）是否完整，尤其“围观”拍有没有漏？
- 伏笔（防烂尾）：是否有挖了没填的坑、突然冒出没铺垫的设定？
- 人设（一致性）：人物言行是否前后一致、有没有 OOC？主角是否有主观能动性？反派强度是否撑得起主角的胜利？
- 节奏（呼吸感）：是否一直紧绷或一直平淡？战斗/打脸后有没有舒缓，舒缓后有没有再拉紧？句长是否整齐划一像流水线？
- 人味（像不像真人写的）：情绪是不是太“平均”（都合理反应，没人真的失控）？冲突是不是太“干净”（误会→解释→解决，缺“越滚越脏”）？句子是不是太“顺”（无长短变化、无停顿、无不完整表达）？人物是不是太“正常”（没有“明知错还做”的不理性）？读起来像说明书还是像情绪记录？

请只输出 JSON，不要解释，不要 Markdown，不要代码块。格式如下：
{
  "pass": true,
  "summary": "一句话总结本章网文阅读感",
  "scores": {
    "hook": 0,
    "pace": 0,
    "readability": 0,
    "dialogue": 0,
    "emotion": 0,
    "cliffhanger": 0,
    "platformFit": 0
  },
  "issues": [
    {
      "severity": "high/medium/low",
      "type": "hook/pace/readability/dialogue/emotion/cliffhanger/platformFit",
      "problem": "具体问题",
      "fix": "最小修复方向"
    }
  ],
  "strengths": ["1个到3个优点"],
  "repairNeeded": true
}

判定规则：
- 任一核心项明显拖后腿，或存在“大段难读、开头过慢、章尾无钩子、空转描写严重”等问题时，"pass" 必须为 false。
- 如果整体可读但还能优化，"pass" 可以为 true，同时 issues 只保留 low/medium。
- 分数范围 0-10，务必拉开差距，不要全部打高分。
- 问题描述必须具体，不能写空话。

【前文摘要】
${trimToCharLimit(globalSummary || '', 3500)}

【当前角色状态】
${trimToCharLimit(characterState || '', 1800)}

【上一章结尾】
${trimToCharLimit(previousExcerpt || '', 1200, { fromEnd: false })}

【本章定位】
本章定位：${chapterRole || ''}
核心作用：${chapterPurpose || ''}
本章简述：${chapterSummary || ''}

【最新章节正文】
${trimToCharLimit(chapterText || '', 12000)}`;
}

export function buildWebnovelSkillRepairPrompt({
  chapterText,
  review,
  wordNumber = 2000,
  globalSummary,
  characterState,
  chapterRole,
  chapterPurpose,
  chapterSummary,
}) {
  const target = Math.floor((Number(wordNumber) || 2000) * 0.96);
  const issues = Array.isArray(review?.issues) ? review.issues : [];
  return `你是“网文润稿 skill”。请根据审校结果，把这一章修成更适合平台连载追读的成稿。

【润稿目标】
- 更像成熟网文成稿：通俗、利落、冲突清楚、推进明确、手机端易读。
- 保住剧情、设定、角色关系、道具状态、世界规则，不要改主线事件。
- 让本章至少更清楚地呈现：目标、阻碍、反馈/反转、章尾钩子。

【必须解决的问题】
${issues.map((item, index) => `${index + 1}. [${item.severity || 'medium'}][${item.type || 'general'}] ${item.problem || ''}；修复方向：${item.fix || ''}`).join('\n') || '（无明确问题，但仍需整体优化网文阅读感）'}

【硬规则】
1. 只输出修订后的章节正文，不要说明，不要标题，不要 Markdown。
2. 不改变人物伤势、道具归属、系统规则、前文因果。
3. 不要把章节写短，目标篇幅不少于 ${target} 字；原文已达标时，不要明显压缩。
4. 开头若偏慢，必须把钩子前置；但不能硬改成另一段剧情。
5. 若段落过厚，主动拆成短段；对话、动作转折、信息揭露时优先分段。
6. 少用解释腔、模板句和空泛情绪词，优先用动作、反馈、场景压力和人物选择表达。
7. 章尾如果钩子不够，必须在不改变主线的前提下，把下一步风险、发现、选择或代价写得更勾人。

【前文摘要】
${trimToCharLimit(globalSummary || '', 3200)}

【当前角色状态】
${trimToCharLimit(characterState || '', 1600)}

【本章定位】
本章定位：${chapterRole || ''}
核心作用：${chapterPurpose || ''}
本章简述：${chapterSummary || ''}

【当前正文】
${trimToCharLimit(chapterText || '', 12000)}

请直接输出修订后的章节正文。`;
}

/** 合并文风 + 番茄追读的一次性润稿（替代 style + webnovel 双 LLM） */
export function buildUnifiedQualityRepairPrompt(chapterText, issues, opts = {}) {
  const target = Math.floor((Number(opts.wordNumber) || 2000) * 0.96);
  const uniqueIssues = [...new Set((issues || []).filter(Boolean))];
  const voiceSection = formatVoiceSection(opts.voiceCard);
  return `你是番茄小说平台的资深责编，目标是把本章修到「追读感 9.0 档」成稿：开头有钩子、中段有推进、章尾有悬念，手机端易读，但不改剧情与设定。

${voiceSection ? `${voiceSection}\n\n` : ''}【待修问题】
${uniqueIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n') || '（整体润稿：加强钩子、推进感与章尾追读）'}

【番茄 9.0 档硬标准】
1. 开头 400 字内必须出现危机/异常/任务/冲突/利益点之一；前三章必须打脸+身份反转。
2. 本章至少完成：小目标、阻碍、反馈/反转、章尾钩子 中的三项。
3. 章尾最后 2-3 段必须留下未解悬念或即将发生的变故——在“即将揭晓”的前一秒断章。
4. 手机端短段阅读：对话、动作转折、信息揭露处主动分段；单段不宜超过 5 行阅读感。
5. 通俗利落，少模板句、少解释腔、少「不是……而是……」对照句。

【润稿硬规则】
1. 只输出修订后的章节正文，不要解释、标题、Markdown。
2. 不改变事件顺序、因果、人物选择、伤势状态、道具归属、世界规则。
3. 目标篇幅不少于 ${target} 字；已达标时不要明显压缩。
4. 不要把词语硬切开插标点；系统【...】块单独成行。
5. 句式要有呼吸感：短句与长句交错，避免每句长度都差不多；用停顿、断句、话说一半表现情绪；段落长短交错，打破对称。
6. 情绪演出来：删“他很愤怒”“她很伤心”式直白情绪句，换成神态、小动作、生理反应、潜台词或留白（1-2 个具体细节，不堆比喻）。
7. 破折号——一章最多一次；省略号用……；并列用顿号；对话用弯引号“”；删掉“非常、极其”等极端词和强行升华句。

【前文摘要】
${trimToCharLimit(opts.globalSummary || '', CAP.globalSummary)}

【当前角色状态】
${trimToCharLimit(opts.characterState || '', CAP.characterState)}

【本章定位】
本章定位：${opts.chapterRole || ''}
核心作用：${opts.chapterPurpose || ''}
本章简述：${opts.chapterSummary || ''}

【章节正文】
${trimToCharLimit(chapterText || '', CAP.chapterText)}

请直接输出修订后的章节正文。`;
}
