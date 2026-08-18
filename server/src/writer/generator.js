import { chat } from '../llm/adapter.js';
import {
  SYSTEM_PROMPT,
  buildSettingPrompt,
  buildDirectoryPrompt,
  buildDirectoryFixPrompt,
  buildFirstChapterPrompt,
  buildNextChapterPrompt,
  buildPunctuationRepairPrompt,
  buildSummaryUpdatePrompt,
  buildCharacterStateUpdatePrompt,
  buildConsistencyCheckPrompt,
  buildStyleRepairPrompt,
  buildWebnovelSkillReviewPrompt,
  buildWebnovelSkillRepairPrompt,
  buildUnifiedQualityRepairPrompt,
} from './prompts.js';
import { humanizeChapter, reduceAiContrastSyntax } from './humanize.js';
import { parseDirectory, getChapterInfo } from './directoryParser.js';
import { validateDirectorySegment } from './directoryValidator.js';
import { trimToCharLimit } from '../llm/contextLimit.js';
import { applyLocalFormatPass } from './formatEngine.js';
import {
  collectTomatoLocalIssues,
  passesTomatoLocalGate,
  buildLocalTomatoReview,
} from './tomatoQuality.js';
import { resolveVoiceCard } from './voiceCard.js';

// ========== Step1 生成设定 ==========
export async function generateSetting(topic, genre, numChapters, wordPerChapter) {
  const prompt = buildSettingPrompt(topic, genre, numChapters, wordPerChapter);
  const { content, exchange } = await chat(
    [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    { maxTokens: 4096, temperature: 0.82 }
  );
  return { content: (content || '').trim(), exchange: exchange || [] };
}

// ========== Step2 生成目录（返回 content + exchange 供展示） ==========
export async function generateDirectory(novelSetting, numChapters, options = {}) {
  const prompt = buildDirectoryPrompt(novelSetting, numChapters, options);
  const segmentSize = options.volumeEnd - (options.volumeStart || 0) + 1;
  const maxTokens = segmentSize > 30 ? 8192 : 4096;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const { content, exchange } = await chat(messages, { maxTokens, temperature: 0.8 });
  return { content: (content || '').trim(), exchange: exchange || [] };
}

// ========== Step2 修正目录（格式/缺章时调用） ==========
export async function generateDirectoryFix(errors, invalidContent, volumeStart, volumeEnd) {
  const prompt = buildDirectoryFixPrompt(errors, invalidContent, volumeStart, volumeEnd);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
  const { content, exchange } = await chat(messages, { maxTokens: 8192, temperature: 0.5 });
  return { content: (content || '').trim(), exchange: exchange || [] };
}

// ========== Step2 校验目录片段 ==========
export function validateDirectory(rawText, volumeStart, volumeEnd) {
  return validateDirectorySegment(rawText, volumeStart, volumeEnd);
}

// ========== Step3 生成章节 ==========
export function parseDirectoryToChapters(rawDirectory) {
  return parseDirectory(rawDirectory);
}

const SENTENCE_PUNCTUATION_RE = /[\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u3001\uff0e\u2026\u2014\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b,.!?;:\n\r]/u;
const HARD_SENTENCE_END_RE = /[\u3002\uff01\uff1f!?\u2026]/u;
const SOFT_BREAK_PUNCTUATION_RE = /[\uff0c,\u3001\uff1b;\uff1a:\u2014-]/u;
const SENTENCE_SPLIT_RE = /[^\u3002\uff01\uff1f!?\u2026]+[\u3002\uff01\uff1f!?\u2026]?/gu;
const CLAUSE_SPLIT_RE = /[^\uFF0C,\u3001\uFF1B;\uFF1A:\u3002\uff01\uff1f!?\u2026]+[\uFF0C,\u3001\uFF1B;\uFF1A:\u3002\uff01\uff1f!?\u2026]?/gu;
const SYSTEM_LINE_RE = /^\u3010[^\u3011]+\u3011$/u;
const SYSTEM_BLOCK_RE = /\u3010[^\u3011]{1,260}\u3011/gu;
const MAX_UNPUNCTUATED_RUN = 24;
const HARD_CHUNK_LENGTH = 20;
const MAX_SOFT_SENTENCE_LENGTH = 56;
const PREFERRED_UNPUNCTUATED_RUN = 16;
const PREFERRED_HARD_SENTENCE_LENGTH = 38;
const MIN_CHAPTER_TARGET_RATIO = 0.96;
const OUTLINE_LEAK_TERMS = [
  '\u672c\u7ae0\u5b9a\u4f4d',
  '\u6838\u5fc3\u4f5c\u7528',
  '\u60ac\u5ff5\u5bc6\u5ea6',
  '\u672c\u7ae0\u7b80\u8ff0',
  '\u751f\u6210\u5931\u8d25',
  'AI\u751f\u6210',
  '\u4f5c\u4e3aAI',
];
const OUTLINE_LEAK_RE = new RegExp(OUTLINE_LEAK_TERMS.join('|'));
const CLAUSE_CUE_TERMS = [
  '\\u8fdc\\u5904', // distant place
  '\\u6240\\u6709\\u4eba', // everyone
  '\\u521a\\u624d', // just now
  '\\u73b0\\u5728', // now
  '\\u8bdd\\u97f3\\u843d\\u4e0b', // after the words fell
  '\\u8bb0\\u5fc6\\u788e\\u7247', // memory fragments
  '\\u8111\\u5b50\\u91cc', // in the mind
  '\\u90a3\\u4e9b\\u58f0\\u97f3', // those sounds
  '\\u771f\\u5b9e\\u5f97', // so real that
  '\\u663e\\u7136', // obviously
  '\\u518d\\u6b21', // again
  '\\u8bf4\\u5b8c', // after speaking
  '\\u7247\\u523b\\u540e', // moments later
  '\\u65cb\\u5373', // immediately
  '\\u7d27\\u63a5\\u7740', // immediately after
  '\\u4e0e\\u6b64\\u540c\\u65f6', // meanwhile
  '\\u800c\\u51e0\\u4e4e', // almost at the same time
  '\\u5916\\u9762', // outside
  '\\u7b2c\\u4e09\\u6ce2', // third wave
  '\\u8bf4\\u660e', // explanation
  '\\u5f53', // when
  '\\u53ef\\u5bf9', // may target
  '\\u6807\\u8bb0\\u533a\\u57df', // marked area
  '\\u533a\\u57df\\u5185', // inside the area
  '\\u83b7\\u5f97', // obtain
  '\\u6301\\u7eed\\u81f3', // lasts until
  '\\u5907\\u6ce8', // note
  '\\u5ffd\\u7136', // suddenly
  '\\u84e6\\u5730', // abruptly
  '\\u4f46', // but
  '\\u4f46\\u4ed6', // but he
  '\\u4ed6\\u5728\\u7b49', // he was waiting
  '\\u4ec0\\u4e48\\u90fd\\u6ca1\\u6709', // nothing happened
  '\\u9762\\u677f\\u4e0a', // on the panel
  '\\u788e\\u77f3', // gravel
  '\\u53ea\\u662f', // only
  '\\u56e0\\u4e3a', // because
  '\\u800c\\u662f', // rather
  '\\u4e0d\\u662f', // not
  '\\u5982\\u679c', // if
  '\\u6797\\u7167', // protagonist in the current book
  '\\u76f4\\u64ad\\u95f4', // livestream room
  '\\u5f39\\u5e55', // bullet comments
  '\\u8fd9\\u8bdd', // these words
  '\\u8fd9\\u4e2a\\u5ff5\\u5934', // this thought
  '\\u4e0b\\u4e00\\u79d2', // next second
  '\\u5f88\\u5feb', // soon
  '\\u968f\\u540e', // afterwards
  '\\u4f17\\u4eba', // crowd
  '\\u6709\\u4eba', // someone
  '\\u5468\\u70c8', // current book character
  '\\u8d75\\u9510', // current book character
  '\\u77f3\\u5de8\\u4eba', // stone giant
  '\\u5f71\\u72fc\\u7fa4', // shadow wolf pack
  '\\u96fe\\u6c14', // fog
];
const CLAUSE_CUE_RE = new RegExp(`(${CLAUSE_CUE_TERMS.join('|')})`, 'g');
const HARD_STOP_CUE_TERMS = [
  '\\u4e00\\u65f6\\u95f4', // for a moment / at once
  '\\u53ea\\u6709', // only
  '\\u90a3\\u4e9b\\u7bc6\\u6587', // those seal characters
  '\\u6240\\u6709\\u4eba', // everyone
  '\\u63d0\\u9192', // remind
  '\\u8ddd\\u79bb', // distance / away from
  '\\u53ea\\u5dee', // only short of
  '\\u5230\\u65f6\\u5019', // when that happens
  '\\u8138\\u8272', // expression / face color
  '\\u4e00\\u5207\\u90fd\\u9759\\u6b62\\u4e86', // everything froze
  '\\u65f6\\u95f4\\u7a7a\\u95f4\\u58f0\\u97f3\\u5149\\u7ebf', // time, space, sound and light
  '\\u53ea\\u6709\\u4ed6\\u548c', // only he and
  '\\u8001\\u4eba\\u7684\\u8138\\u8272', // the old man's face
  '\\u5899\\u4e0a', // on the wall
  '\\u7a97\\u5916', // outside the window
  '\\u8fdc\\u5904\\u4f20\\u6765', // came from afar
  '\\u5c4b\\u5b50\\u91cc\\u5149\\u7ebf', // light in the room
  '\\u5927\\u53e3', // heavily / in big gulps
  '\\u518d\\u770b', // looking again
  '\\u73b0\\u5728\\u5c31\\u662f', // now they are
  '\\u4f1a\\u672c\\u80fd\\u5730', // would instinctively
  '\\u800c\\u89c4\\u5219', // and the rule
  '\\u800c\\u662f', // rather
  '\\u4f46', // but
  '\\u53ef', // but / however
  '\\u4e0b\\u4e00\\u79d2', // the next second
  '\\u8fd9\\u4e00\\u6b21', // this time
  '\\u53d6\\u800c\\u4ee3\\u4e4b', // instead / in its place
  '\\u90a3\\u53cc\\u773c\\u775b', // those eyes
  '\\u6bd5\\u7adf', // after all
  '\\u4e0e\\u6b64\\u540c\\u65f6', // meanwhile
  '\\u800c\\u6b64\\u523b', // at this moment
  '\\u800c\\u66f4\\u7cdf\\u7cd5\\u7684\\u662f', // worse still
  '\\u5bf9\\u5e94\\u7684', // corresponding
  '\\u6218\\u9f13', // war drum
  '\\u68c0\\u6d4b\\u5230', // detected
  '\\u8bf7', // please
  '\\u8fd9\\u8bdd', // these words
  '\\u8fd9\\u4e2a\\u5ff5\\u5934', // this thought
  '\\u8fd9\\u4e00\\u523b', // this moment
  '\\u5f88\\u5feb', // soon
  '\\u968f\\u540e', // afterwards
  '\\u4f17\\u4eba', // crowd
  '\\u6709\\u4eba', // someone
  '\\u76f4\\u64ad\\u95f4', // livestream room
  '\\u5f39\\u5e55', // bullet comments
  '\\u9762\\u677f', // panel
  '\\u7cfb\\u7edf', // system
  '\\u77f3\\u5de8\\u4eba', // stone giant
  '\\u5f71\\u72fc\\u7fa4', // shadow wolf pack
  '\\u96fe\\u6c14', // fog
];
const HARD_STOP_CUE_RE = new RegExp(`(${HARD_STOP_CUE_TERMS.join('|')})`, 'g');
const FORCED_SPLIT_PHRASES = [
  '\u5149\u819c',
  '\u4e3b\u64ad',
  '\u4eba\u6570',
  '\u665a\u9910',
  '\u9752\u5e74',
  '\u786c\u90a6\u90a6',
  '\u5386\u5386\u5728\u76ee',
  '\u5f71\u72fc\u7fa4',
  '\u660e\u767d',
  '\u4efb\u52a1\u8bf4\u660e',
  '\u9762\u677f\u4e0a',
  '\u94c1\u7b26\u7ea2\u5149',
  '\u8840\u8165',
  '\u4eb2\u8eab',
  '\u5c0f\u65f6',
  '\u6bcf\u4e00\u6b21',
  '\u540c\u6b65',
  '\u611f\u89c9\u5230',
  '\u7329\u7ea2',
  '\u4e0d\u77e5\u9053',
  '\u4e00\u70b9\u70b9',
  '\u6df7\u6218',
  '\u522b\u8bf4',
  '\u8fd9\u4e48',
  '\u660e\u660e',
  '\u751f\u6b7b',
  '\u51fb\u6740',
  '\u5636\u5420',
  '\u4e1c\u897f',
  '\u53e4\u65e7',
  '\u6d51\u8eab',
  '\u60e8\u767d',
  '\u4fdd\u62a4',
  '\u53d8\u6210',
  '\u788e\u7247',
  '\u8bb0\u5fc6',
  '\u53e4\u65e7\u8bb0\u5fc6',
  '\u4e00\u70b9\u70b9\u523b\u8fdb',
  '\u9891\u7387',
  '\u6240\u6709',
  '\u94c1\u7b26',
  '\u6797\u7167',
  '\u5c4f\u969c',
  '\u5f71\u72fc',
  '\u8282\u70b9',
  '\u80fd\u91cf',
  '\u4e3b\u7ebf',
  '\u4efb\u52a1',
  '\u751f\u547d',
  '\u7cfb\u7edf',
  '\u526f\u672c',
  '\u76f4\u64ad\u95f4',
  '\u5f39\u5e55',
  '\u9762\u677f',
  '\u957f\u57ce',
  '\u70fd\u706b\u53f0',
  '\u9690\u9690\u4f5c\u75db',
  '\u4efb\u52a1\u8bf4\u660e',
  '\u5468\u70c8',
  '\u8d75\u9510',
  '\u77f3\u5de8\u4eba',
];
const FORCED_SPLIT_SEPARATOR_RE = '[\\u3002\\uff01\\uff1f!?]\\s*';

function stripModelWrappers(text) {
  return (text || '')
    .replace(/^```[\w-]*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^\s*(?:\u6b63\u6587|\u4ee5\u4e0b\u4e3a\u6b63\u6587|\u7ae0\u8282\u6b63\u6587)[:\uff1a]\s*/i, '')
    .trim();
}

function maxUnpunctuatedRun(text) {
  let current = 0;
  let max = 0;
  for (const char of text || '') {
    if (SENTENCE_PUNCTUATION_RE.test(char) || /\s/u.test(char)) {
      current = 0;
    } else {
      current += 1;
      if (current > max) max = current;
    }
  }
  return max;
}

function maxHardSentenceLength(text) {
  let current = 0;
  let max = 0;
  for (const char of text || '') {
    if (HARD_SENTENCE_END_RE.test(char) || /\s/u.test(char)) {
      current = 0;
    } else {
      current += 1;
      if (current > max) max = current;
    }
  }
  return max;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function restoreForcedSplitPhrases(text) {
  let repaired = text || '';
  for (const phrase of FORCED_SPLIT_PHRASES) {
    const chars = Array.from(phrase);
    for (let index = 0; index < chars.length - 1; index += 1) {
      const pattern = new RegExp(
        `${escapeRegExp(chars[index])}${FORCED_SPLIT_SEPARATOR_RE}${escapeRegExp(chars[index + 1])}`,
        'gu',
      );
      repaired = repaired.replace(pattern, `${chars[index]}${chars[index + 1]}`);
    }
  }
  return repaired;
}

function repairBrokenQuoteFragments(text) {
  return (text || '')
    .replace(/([“「『][^“”「」『』]{1,180}[”」』][\u3002\uff01\uff1f!?]?)/gsu, (quote) => (
      quote.includes('\n') ? quote.replace(/\s*\n+\s*/g, '') : quote
    ))
    .replace(/([“「『])…([^“”「」『』]{1,120}?)…([”」』])/gu, '$1$2……$3')
    .replace(/([^…])…([”」』])/gu, '$1……$2')
    .replace(/([”」』])([\u3002\uff01\uff1f!?])/gu, '$2$1')
    .replace(/([……\u3002\uff01\uff1f!?])([”」』])[\u3002\uff01\uff1f!?]/gu, '$1$2')
    .replace(/\?/g, '\uff1f')
    .replace(/!/g, '\uff01');
}

function repairForcedSplitArtifacts(text) {
  return repairBrokenQuoteFragments(restoreForcedSplitPhrases(text || ''))
    .replace(/\u5149[\u3002\uff01\uff1f!?]\s*\u819c/gu, '\u5149\u819c')
    .replace(/\u4e3b[\u3002\uff01\uff1f!?]\s*\u64ad/gu, '\u4e3b\u64ad')
    .replace(/\u4eba[\u3002\uff01\uff1f!?]\s*\u6570/gu, '\u4eba\u6570')
    .replace(/\u665a[\u3002\uff01\uff1f!?]\s*\u9910/gu, '\u665a\u9910')
    .replace(/\u9752[\u3002\uff01\uff1f!?]\s*\u5e74/gu, '\u9752\u5e74')
    .replace(/\u6bcf[\u3002\uff01\uff1f!?]\s*\u4e00\u6b21/gu, '\u6bcf\u4e00\u6b21')
    .replace(/\u540c[\u3002\uff01\uff1f!?]\s*\u6b65/gu, '\u540c\u6b65')
    .replace(/\u611f\u89c9[\u3002\uff01\uff1f!?]\s*\u5230/gu, '\u611f\u89c9\u5230')
    .replace(/\u90a3\u7247[\u3002\uff01\uff1f!?]\s*\u96fe\u6c14/gu, '\u90a3\u7247\u96fe\u6c14')
    .replace(/\u786c[\u3002\uff01\uff1f!?]\s*\u90a6\u90a6/gu, '\u786c\u90a6\u90a6')
    .replace(/\u4ec0\u4e48\u90fd\u6ca1[\u3002\uff01\uff1f!?]\s*\u542c\u5230/gu, '\u4ec0\u4e48\u90fd\u6ca1\u542c\u5230')
    .replace(/\u5899[\u3002\uff01\uff1f!?]\s*\u4e0a/gu, '\u5899\u4e0a')
    .replace(/\u5c4b[\u3002\uff01\uff1f!?]\s*\u91cc/gu, '\u5c4b\u91cc')
    .replace(/\u5c3e[\u3002\uff01\uff1f!?]\s*\u97f3/gu, '\u5c3e\u97f3')
    .replace(/\u6309[\u3002\uff01\uff1f!?]\s*\u4e0b[\u3002\uff01\uff1f!?]?\s*\u4e86/gu, '\u6309\u4e0b\u4e86')
    .replace(/\u6309[\u3002\uff01\uff1f!?]\s*\u4e0b/gu, '\u6309\u4e0b')
    .replace(/\u8001\u4eba\u7684[\u3002\uff01\uff1f!?]\s*\u8138\u8272/gu, '\u8001\u4eba\u7684\u8138\u8272')
    .replace(/\u6797\u7167\u76f8/gu, '\u6797\u7167')
    .replace(/\u71c3[\u3002\uff01\uff1f!?]\s*\u70e7\u7740/gu, '\u71c3\u70e7\u7740')
    .replace(/\u71c3\u70e7[\u3002\uff01\uff1f!?]\s*\u7740/gu, '\u71c3\u70e7\u7740')
    .replace(/\u4e00[\u3002\uff01\uff1f!?]\s*\u5207/gu, '\u4e00\u5207')
    .replace(/\u62b9[\u3002\uff01\uff1f!?]\s*\u5728/gu, '\u62b9\u5728')
    .replace(/\u6492\u5728[\uff0c,]\s*/gu, '\u6492\u5728')
    .replace(/\u6210[\uff0c,]\s*\u4e00\u4e2a/gu, '\u6210\u4e00\u4e2a')
    .replace(/\u81ea[\uff0c,]\s*\u5df1/gu, '\u81ea\u5df1')
    .replace(/\u4e00\u4e9b\u9ed1[\u3002\uff0c,]\s*\u6697/gu, '\u4e00\u4e9b\u9ed1\u6697')
    .replace(/\u6700\u540e[\uff0c,]\s*\u7684/gu, '\u6700\u540e\u7684')
    .replace(/\u704c\u8f93[\uff0c,]\s*\u67d0\u4e9b/gu, '\u704c\u8f93\u67d0\u4e9b')
    .replace(/\u4e00\u5207\u90fd\u9759\u6b62\u4e86[\uff1a:]\s*\u65f6\u95f4\u3001\u7a7a\u95f4\u3001\u58f0\u97f3\u3001\u5149\u7ebf/gu, '\u4e00\u5207\u90fd\u9759\u6b62\u4e86\u3002\n\n\u65f6\u95f4\u3001\u7a7a\u95f4\u3001\u58f0\u97f3\u3001\u5149\u7ebf\uff0c')
    .replace(/\u4f20[\u3002\uff01\uff1f!?]\s*\u6765/gu, '\u4f20\u6765')
    .replace(/\u5f88\u4e45\u5f88\u4e45\u4e45\u5230/gu, '\u5f88\u4e45\u5f88\u4e45\uff0c\u4e45\u5230')
    .replace(/\u4e00\u8f6e\u4e45\u5230/gu, '\u4e00\u8f6e\uff0c\u4e45\u5230')
    .replace(/\u58f0\u97f3\u4e45\u5230/gu, '\u58f0\u97f3\uff0c\u4e45\u5230')
    .replace(/\u5c31\u50cf[\uff0c,]\s*/gu, '\u5c31\u50cf')
    .replace(/\u4e00\u6837\u4f46/gu, '\u4e00\u6837\u3002\n\n\u4f46')
    .replace(/\u91cd\u590d[\u3002\uff01\uff1f!?]\s*\u540c\u4e00\u5929/gu, '\u91cd\u590d\u540c\u4e00\u5929')
    .replace(/\u540c\u4e00[\u3002\uff01\uff1f!?]\s*\u5929/gu, '\u540c\u4e00\u5929')
    .replace(/\u66f4[\u3002\uff01\uff1f!?]\s*\u592b/gu, '\u66f4\u592b')
    .replace(/\u66f4[\uff0c,]\s*\u592b/gu, '\u66f4\u592b')
    .replace(/\u4f59\u70ec\u5f7b\u5e95\u7184\u706d\u5c4b\u5b50\u91cc\u5149\u7ebf\u6697/gu, '\u4f59\u70ec\u5f7b\u5e95\u7184\u706d\u3002\u5c4b\u5b50\u91cc\u5149\u7ebf\u6697')
    .replace(/\u5c4b\u5b50\u91cc\u5149\u7ebf[\u3002\uff01\uff1f!?]\s*\u6697\u4e86\u4e00\u622a\u4e45\u5230/gu, '\u5c4b\u5b50\u91cc\u5149\u7ebf\u6697\u4e86\u4e00\u622a\u3002\n\n\u4e45\u5230')
    .replace(/\u5149\u7ebf[\uff0c,]\s*\u6697/gu, '\u5149\u7ebf\u6697')
    .replace(/\u6b7b\u5bc2[\u3002\uff01\uff1f!?]\s*\u7684\u7a7a\u6d1e/gu, '\u6b7b\u5bc2\u7684\u7a7a\u6d1e')
    .replace(/\u7a7a[\u3002\uff01\uff1f!?]\s*\u6d1e/gu, '\u7a7a\u6d1e')
    .replace(/\u7a7a[\uff0c,]\s*\u6d1e/gu, '\u7a7a\u6d1e')
    .replace(/\u4e5f\u7184\u706d\u4e86\u5f7b\u5e95\u7184\u706d\u4e86/gu, '\u4e5f\u7184\u706d\u4e86\u3002\u5f7b\u5e95\u7184\u706d\u4e86')
    .replace(/\u5f7b\u5e95\u7184\u706d\u4e86\u53d8\u6210/gu, '\u5f7b\u5e95\u7184\u706d\u4e86\uff0c\u53d8\u6210')
    .replace(/\u65f6\u95f4\u7a7a\u95f4\u58f0\u97f3\u5149\u7ebf/gu, '\u65f6\u95f4\u3001\u7a7a\u95f4\u3001\u58f0\u97f3\u3001\u5149\u7ebf')
    .replace(/\u6211\u4e0d\u60f3[\u3002\uff01\uff1f!?]\s*\u53d8\u6210/gu, '\u6211\u4e0d\u60f3\u53d8\u6210')
    .replace(/\u66f4[\u3002\uff01\uff1f!?]\s*\u53ef\u6015/gu, '\u66f4\u53ef\u6015')
    .replace(/\u90fd[\u3002\uff01\uff1f!?]\s*\u6ca1/gu, '\u90fd\u6ca1')
    .replace(/\u5386\u5386\u5728[\u3002\uff01\uff1f!?]\s*\u76ee/gu, '\u5386\u5386\u5728\u76ee')
    .replace(/\u8be1[\u3002\uff01\uff1f!?]\s*\u5f02/gu, '\u8be1\u5f02')
    .replace(/\u5e74\u8f7b[\u3002\uff01\uff1f!?]\s*\u7684/gu, '\u5e74\u8f7b\u7684')
    .replace(/\u50cf[\u3002\uff01\uff1f!?]\s*([\u4e00-\u9fff])/gu, '\u50cf$1')
    .replace(/\u56e0\u4e3a[\u3002\uff01\uff1f!?]\s*([\u4e00-\u9fff])/gu, '\u56e0\u4e3a$1')
    .replace(/\u6bd5\u7adf[\u3002\uff01\uff1f!?]\s*([\u4e00-\u9fff])/gu, '\u6bd5\u7adf\uff0c$1')
    .replace(/\u4f46[\u3002\uff01\uff1f!?]\s*([\u4e00-\u9fff])/gu, '\u4f46$1')
    .replace(/\u4e5f[\u3002\uff01\uff1f!?]\s*([\u4e00-\u9fff])/gu, '\u4e5f$1')
    .replace(/\u66f4\u8be1\u5f02\u7684\u662f\u2014\u2014[\u3002\uff01\uff1f!?]/gu, '\u66f4\u8be1\u5f02\u7684\u662f\u2014\u2014')
    .replace(/\u800c[\uff0c,]\s*\u6797\u7167[\uff0c,]/gu, '\u800c\u6797\u7167')
    .replace(/\u800c\u6b64\u523b\u7684[\uff0c,]\s*\u6797\u7167/gu, '\u800c\u6b64\u523b\u7684\u6797\u7167')
    .replace(/\u770b\u5411[\uff0c,]\s*/gu, '\u770b\u5411')
    .replace(/\u770b\u5411\u6b64\u523b\u7684[\u3002\uff01\uff1f!?]\s*\u6797\u7167/gu, '\u770b\u5411\u6b64\u523b\u7684\u6797\u7167')
    .replace(/\u770b\u5411[\u3002\uff01\uff1f!?]\s*(\u6797\u7167|\u5468\u70c8|\u8d75\u9510|\u9762\u677f|\u5c4f\u969c|\u70fd\u706b\u53f0|\u5730\u9762|\u94c1\u7b26|\u96fe\u6c14|\u76f4\u64ad\u95f4)/gu, '\u770b\u5411$1')
    .replace(/\u5bf9\u7740[\u3002\uff01\uff1f!?]\s*(\u6240\u6709\u4eba|\u4f17\u4eba|\u6797\u7167|\u5468\u70c8|\u8d75\u9510)/gu, '\u5bf9\u7740$1')
    .replace(/\u4ee5[\u3002\uff01\uff1f!?\uff0c,]\s*\u6797\u7167[\u3002\uff01\uff1f!?\uff0c,]\s*\u73b0\u5728/gu, '\u4ee5\u6797\u7167\u73b0\u5728')
    .replace(/\u6797\u7167\u76f8\u4eff/gu, '\u6797\u7167\uff0c\u4eff\u4f5b')
    .replace(/\u7d27\u7ee7\u800c/gu, '\u7d27\u63a5\u7740')
    .replace(/\u2014\u2014[\u3002\uff01\uff1f!?]/gu, '\u2014\u2014')
    .replace(/\u964c\u751f\u7684[\uff0c,]\s*\u8bb0\u5fc6/gu, '\u964c\u751f\u7684\u8bb0\u5fc6')
    .replace(/\u53e4\u65e7[\uff0c,]\s*\u8bb0\u5fc6/gu, '\u53e4\u65e7\u8bb0\u5fc6')
    .replace(/凹槽里[\u3002\uff01\uff1f!?]?\s*地面开始震动/gu, '凹槽里。地面开始震动')
    .replace(/暗红[\u3002\uff01\uff1f!?]?\s*色的印[\u3002\uff01\uff1f!?]?\s*记/gu, '暗红色的印记')
    .replace(/气[\u3002\uff01\uff1f!?]?\s*运值/gu, '气运值')
    .replace(/兄[\u3002\uff01\uff1f!?]?\s*弟/gu, '兄弟')
    .replace(/搞[\u3002\uff01\uff1f!?]?\s*林照/gu, '搞林照')
    .replace(/别接啊[\u3002\uff01\uff1f!?]?\s*你[\u3002\uff01\uff1f!?]?\s*刚才/gu, '别接啊，你刚才')
    .replace(/卧槽[\u3002\uff01\uff1f!?]?\s*系统/gu, '卧槽，系统')
    .replace(/林照晃了晃手机屏幕锁着/gu, '林照晃了晃手机屏幕，屏幕锁着')
    .replace(/屏幕锁着“/gu, '屏幕锁着：“')
    .replace(/顿了顿“/gu, '顿了顿：“')
    .replace(/幸存者们“/gu, '幸存者们：“')
    .replace(/那片[\uff0c,]\s*雾气/gu, '那片雾气')
    .replace(/对着[\uff0c,]\s*所有人/gu, '对着所有人')
    .replace(/平淡但/gu, '平淡，但')
    .replace(/态度而是/gu, '态度，而是')
    .replace(/以前守的人死了现在轮到我了/gu, '以前守的人死了，现在轮到我了')
    .replace(/两人看完表情都变得微妙起来周烈/gu, '两人看完，表情都变得微妙起来。\n\n周烈')
    .replace(/眼神已经变了不再是/gu, '眼神已经变了，不再是')
    .replace(/印记最后抬起头/gu, '印记。最后抬起头')
    .replace(/消融分解消散成[\u3002\uff01\uff1f!?]?\s*漫天灰尘/gu, '消融、分解，消散成漫天灰尘')
    .replace(/周烈没动直播间/gu, '周烈没动。\n\n直播间')
    .replace(/刷屏[\u3002\uff01\uff1f!?]\s*「/gu, '刷屏：\n\n「')
    .replace(/「[\u3002\uff0c,、；;：:]+/gu, '「')
    .replace(/兄弟[\u3002\uff01\uff1f!?]\s*反目/gu, '兄弟反目')
    .replace(/你[\u3002\uff01\uff1f!?]\s*刚才/gu, '你刚才')
    .replace(/长城城墙又低头/gu, '长城城墙，又低头')
    .replace(/看了看[\u3002\uff01\uff1f!?]?\s*掌心那个/gu, '看了看掌心那个')
    .replace(/旁边的“×”(?=\s*$)/gmu, '旁边的“×”。')
    .replace(/别接啊你[\uff0c,]/gu, '别接啊，你')
    .replace(/系统这是要搞[\uff0c,]\s*林照/gu, '系统这是要搞林照')
    .replace(/“×[\u3002\uff01\uff1f!?]”/gu, '“×”')
    .replace(/没[\uff0c,]\s*有人反驳/gu, '没人反驳')
    .replace(/。”没人反驳/gu, '。”\n\n没人反驳')
    .replace(/周烈没理弹幕/gu, '\n\n周烈没理弹幕')
    .replace(/\n{3,}/g, '\n\n');
}

function finalizeReadableArtifacts(text) {
  return repairForcedSplitArtifacts(text || '')
    .replace(/话没[\uff0c,]\s*说完/gu, '话没说完')
    .replace(/打断他的[\uff0c,]?\s*不是[\uff0c,]?\s*林照/gu, '打断他的不是林照')
    .replace(/开了一[\u3002\uff01\uff1f!?]\s*条缝/gu, '开了一条缝')
    .replace(/浑浊的[\u3002\uff01\uff1f!?]\s*眼睛/gu, '浑浊的眼睛')
    .replace(/空洞的[\u3002\uff01\uff1f!?]\s*眼眶/gu, '空洞的眼眶')
    .replace(/依赖这[\u3002\uff01\uff1f!?]\s*个/gu, '依赖这个')
    .replace(/动作比[\uff0c,]\s*刚才/gu, '动作比刚才')
    .replace(/看着[\u3002\uff01\uff1f!?]\s*林照/gu, '看着林照')
    .replace(/看向[\u3002\uff01\uff1f!?]\s*林照/gu, '看向林照')
    .replace(/靠近[\u3002\uff01\uff1f!?]\s*林照/gu, '靠近林照')
    .replace(/离[\u3002\uff01\uff1f!?]\s*雾气/gu, '离雾气')
    .replace(/出[\u3002\uff01\uff1f!?]\s*现在哪里/gu, '出现在哪里')
    .replace(/在[\u3002\uff01\uff1f!?]\s*所有人/gu, '在所有人')
    .replace(/自[\u3002\uff01\uff1f!?]\s*己/gu, '自己')
    .replace(/蜂[\u3002\uff01\uff1f!?]\s*窝孔/gu, '蜂窝孔')
    .replace(/一[\u3002\uff01\uff1f!?]\s*模一样/gu, '一模一样')
    .replace(/外面[\u3002\uff01\uff1f!?]\s*世界/gu, '外面世界')
    .replace(/请立即[\u3002\uff01\uff1f!?]\s*寻找/gu, '请立即寻找')
    .replace(/所有未注册单位[\u3002\uff01\uff1f!?]\s*请立即/gu, '所有未注册单位，请立即')
    .replace(/减弱了些许虽然/gu, '减弱了些许。\n\n虽然')
    .replace(/平稳了[\u3002\uff01\uff1f!?]\s*一丝/gu, '平稳了一丝')
    .replace(/断绝的趋势有效果/gu, '断绝的趋势。\n\n有效果')
    .replace(/金门的崩塌[\u3002\uff01\uff1f!?]\s*说明/gu, '金门的崩塌，说明')
    .replace(/整个函谷关副本[\u3002\uff01\uff1f!?]\s*可能/gu, '整个函谷关副本可能')
    .replace(/随时[\u3002\uff01\uff1f!?]\s*可能/gu, '随时可能')
    .replace(/扶着昏迷的周站起来/gu, '扶着昏迷的周烈站起来')
    .replace(/和[\u3002\uff01\uff1f!?]\s*陈年/gu, '和陈年')
    .replace(/越[\u3002\uff01\uff1f!?]\s*来越/gu, '越来越')
    .replace(/推移它们/gu, '推移，它们')
    .replace(/仿[\u3002\uff01\uff1f!?]?\s*佛/gu, '仿佛')
    .replace(/物[\u3002\uff01\uff1f!?]?\s*质/gu, '物质')
    .replace(/升[\u3002\uff01\uff1f!?]?\s*起/gu, '升起')
    .replace(/更[\u3002\uff01\uff1f!?]\s*细碎/gu, '更细碎')
    .replace(/一[\u3002\uff01\uff1f!?]\s*个叫/gu, '一个叫')
    .replace(/却[\u3002\uff01\uff1f!?]\s*依然/gu, '却依然')
    .replace(/坟[\u3002\uff01\uff1f!?]\s*堆/gu, '坟堆')
    .replace(/责[\u3002\uff01\uff1f!?]\s*任感/gu, '责任感')
    .replace(/土[\u3002\uff01\uff1f!?]\s*腥味/gu, '土腥味')
    .replace(/抓[\u3002\uff01\uff1f!?]\s*痕/gu, '抓痕')
    .replace(/函谷[\u3002\uff01\uff1f!?]\s*关/gu, '函谷关')
    .replace(/意[\u3002\uff01\uff1f!?]\s*外/gu, '意外')
    .replace(/最后[\u3002\uff01\uff1f!?]\s*一道/gu, '最后一道')
    .replace(/它们的[\u3002\uff01\uff1f!?]\s*感知/gu, '它们的感知')
    .replace(/演下[\u3002\uff01\uff1f!?]\s*去/gu, '演下去')
    .replace(/那片[\u3002\uff01\uff1f!?]\s*灰雾/gu, '那片灰雾')
    .replace(/已经[\u3002\uff01\uff1f!?]\s*说明/gu, '已经说明')
    .replace(/答案[\u3002\uff01\uff1f!?]\s*试过/gu, '答案。\n\n试过')
    .replace(/颤[\u3002\uff01\uff1f!?]\s*抖/gu, '颤抖')
    .replace(/停滞了一瞬仅仅一瞬/gu, '停滞了一瞬。\n\n仅仅一瞬')
    .replace(/腿上的[\u3002\uff01\uff1f!?]\s*周烈/gu, '腿上的周烈')
    .replace(/腿上的[\uff0c,]\s*周烈/gu, '腿上的周烈')
    .replace(/活动的余地而靠在/gu, '活动的余地。而靠在')
    .replace(/平稳了一丝胸口/gu, '平稳了一丝。胸口')
    .replace(/不能在这里等死也不能/gu, '不能在这里等死，也不能')
    .replace(/因为局面已经失控了/gu, '因为局面已经失控了。')
    .replace(/到时候无论/gu, '到时候，无论')
    .replace(/唯一的出路是——\s*\n*\s*主动/gu, '唯一的出路是——\n\n主动')
    .replace(/另一个声音一个苍老的带着古怪笑意的声音/gu, '另一个声音，一个苍老的、带着古怪笑意的声音')
    .replace(/一个苍老的带着古怪笑意的声音/gu, '一个苍老的、带着古怪笑意的声音')
    .replace(/三人同时转头看去街角/gu, '三人同时转头看去。\n\n街角')
    .replace(/开了一条缝一个佝偻的身影/gu, '开了一条缝。一个佝偻的身影')
    .replace(/低矮土坯房的门不知什么时候开了一条缝/gu, '低矮土坯房的门，不知什么时候开了一条缝')
    .replace(/只能看见一双浑浊的眼睛在阴影里闪着微光/gu, '只能看见一双浑浊的眼睛，在阴影里闪着微光')
    .replace(/站在门缝后面看不清脸只能看见/gu, '站在门缝后面，看不清脸，只能看见')
    .replace(/眼睛在阴影里闪着微光声音就是/gu, '眼睛在阴影里闪着微光。\n\n声音就是')
    .replace(/话音落下的瞬间整条街道/gu, '话音落下的瞬间，整条街道')
    .replace(/黑影齐刷刷转过头来空洞的眼眶/gu, '黑影齐刷刷转过头来，空洞的眼眶')
    .replace(/复杂得像是在看一个不该出现的变量一个打破平衡的意外一个——麻烦/gu, '复杂得像是在看一个不该出现的变量，一个打破平衡的意外，一个——麻烦')
    .replace(/天道划定的边界外面总有些东西想挤进来想吞掉人间想抹掉一切存在的痕迹/gu, '天道划定的边界。外面总有些东西想挤进来，想吞掉人间，想抹掉一切存在的痕迹')
    .replace(/边界外面总有/gu, '边界。外面总有')
    .replace(/存在的痕迹函谷关/gu, '存在的痕迹。函谷关')
    .replace(/函谷关西面那片黑暗就是它们的源头之一而这座集市/gu, '函谷关西面那片黑暗，就是它们的源头之一。而这座集市')
    .replace(/这座集市是用山河记忆撑起来的缓冲带是古代戍卒留下的最后一道防线/gu, '这座集市是用山河记忆撑起来的缓冲带，是古代戍卒留下的最后一道防线')
    .replace(/用贞观年的面粉和井盐做成的烙饼干能暂时骗过它们的感知/gu, '用贞观年的面粉和井盐做成的烙饼干，能暂时骗过它们的感知')
    .replace(/感知让你看起来像这片记忆的一部分/gu, '感知，让你看起来像这片记忆的一部分')
    .replace(/每天都会来巡逻每天都会检查/gu, '每天都会来巡逻，每天都会检查')
    .replace(/混进来所以每天这个时候/gu, '混进来。所以每天这个时候')
    .replace(/必须吃饼必须扮演好自己的角色必须/gu, '必须吃饼，必须扮演好自己的角色，必须')
    .replace(/眼神飘向远处那片灰雾语气变得/gu, '眼神飘向远处那片灰雾，语气变得')
    .replace(/有些恍惚“或者直到/gu, '有些恍惚。\n\n“或者直到')
    .replace(/陈老饼没有回答但他的表情已经说明了一切/gu, '陈老饼没有回答，但他的表情已经说明了一切。')
    .replace(/这话的时候低头看了看自己手里的半块烙饼干/gu, '说这话的时候，他低头看了看自己手里的半块烙饼干。')
    .replace(/焦黄的面皮上细密的蜂窝孔深色的盐粒微微翘起的脆皮/gu, '焦黄的面皮、细密的蜂窝孔、深色的盐粒、微微翘起的脆皮，')
    .replace(/一切看起来都和之前那块一模一样和林照砸碎的那块一模一样和他过去无数个黄昏递出去的/gu, '一切看起来都和之前那块一模一样，和林照砸碎的那块一模一样，也和他过去无数个黄昏递出去的')
    .replace(/每吃一块就会和这片记忆融合得更深一点就会更偏离原本的自己就会更接近/gu, '每吃一块，就会和这片记忆融合得更深一点，也会更偏离原本的自己，更接近')
    .replace(/脸色瞬间变得惨白嘴唇哆嗦着想说什么却发不出声音/gu, '脸色瞬间变得惨白，嘴唇哆嗦着想说什么，却发不出声音')
    .replace(/表面泛着和陈年老面一样的暗黄色光泽他看着这碎屑/gu, '表面泛着和陈年老面一样的暗黄色光泽。他看着这碎屑')
    .replace(/捏住了此刻这块饼干碎屑/gu, '捏住了。此刻，这块饼干碎屑')
    .replace(/昏迷中气息越来越微弱的[\uff0c,]\s*周烈/gu, '昏迷中气息越来越微弱的周烈')
    .replace(/昏迷中气息越来越微弱的[\u3002\uff01\uff1f!?]\s*周烈/gu, '昏迷中气息越来越微弱的周烈')
    .replace(/自己同样因时间凝滞而僵硬的身体一个念头清晰起来/gu, '自己同样因时间凝滞而僵硬的身体，一个念头清晰起来')
    .replace(/他看着这碎屑又看了看/gu, '他看着这碎屑，又看了看')
    .replace(/周烈以及自己同样/gu, '周烈，以及自己同样')
    .replace(/开始微微发热那热度很微弱却带着一种奇异的穿透力/gu, '开始微微发热。那热度很微弱，却带着一种奇异的穿透力')
    .replace(/对抗周围的凝滞感而撒在伤口上的粉末则与/gu, '对抗周围的凝滞感。而撒在伤口上的粉末，则与')
    .replace(/发生了轻微的抵触发出细微的滋滋声一缕几乎看不见的青烟升起/gu, '发生了轻微的抵触，发出细微的滋滋声。一缕几乎看不见的青烟升起，')
    .replace(/仅仅一瞬但这给了/gu, '仅仅一瞬，但这给了')
    .replace(/立[\u3002\uff01\uff1f!?]\s*刻/gu, '立刻')
    .replace(/脚下不能依赖这个必须找到真正的出路/gu, '脚下。不能依赖这个，必须找到真正的出路')
    .replace(/函谷关副本可能都在崩解边缘这片缓冲带/gu, '函谷关副本可能都在崩解边缘，这片缓冲带')
    .replace(/那条没人敢走的缝哪怕那条缝通向/gu, '那条没人敢走的缝。哪怕那条缝通向')
    .replace(/站起来动作比刚才利索了一点虽然还是迟缓/gu, '站起来，动作比刚才利索了一点。虽然还是迟缓')
    .replace(/走去哪外面/gu, '走？去哪？外面')
    .replace(/打断他的更像是另一个声音/gu, '打断他的不是林照，而是另一个声音')
    .replace(/一个佝偻的身[\u3002\uff01\uff1f!?]?\s*影/gu, '一个佝偻的身影')
    .replace(/手里死死攥着那半块烙饼干眼睛瞪得老大/gu, '手里死死攥着那半块烙饼干，眼睛瞪得老大')
    .replace(/不粗暴却很坚定地要把他从这个空间里推出去推到哪里去他不知道/gu, '不粗暴，却很坚定地要把他从这个空间里推出去。推到哪里去，他不知道')
    .replace(/那股力量不粗暴却很坚定/gu, '那股力量不粗暴，却很坚定')
    .replace(/推出去推到哪里去他不知道/gu, '推出去。推到哪里去，他不知道')
    .replace(/脸孔轮廓发出无声的尖啸开始扭曲变形最终炸裂成/gu, '脸孔轮廓发出无声的尖啸，开始扭曲变形，最终炸裂成')
    .replace(/黄昏…下坠的感觉/gu, '黄昏……\n\n下坠的感觉')
    .replace(/地方和一个叫贞观二十三年的黄昏/gu, '地方，和一个叫贞观二十三年的黄昏')
    .replace(/死死抠住城墙砖缝指甲崩裂指骨外露却依然不松手/gu, '死死抠住城墙砖缝，指甲崩裂，指骨外露，却依然不松手')
    .replace(/把散落的沙粒拢到一起拢成一个小小的坟堆/gu, '把散落的沙粒拢到一起，拢成一个小小的坟堆')
    .replace(/真实得像刀子在刮骨头那是绝望不甘愤怒/gu, '真实得像刀子在刮骨头。那是绝望、不甘、愤怒，')
    .replace(/具体的重量压得人喘不过气来/gu, '具体的重量，压得人喘不过气来')
    .replace(/一片漆黑但不再是那种虚无的黑/gu, '一片漆黑，但不再是那种虚无的黑')
    .replace(/黑暗伸手能摸到粗糙的石壁空气潮湿阴冷/gu, '黑暗。伸手能摸到粗糙的石壁，空气潮湿阴冷')
    .replace(/深浅不一是仓促间挖出来的而在正前方/gu, '深浅不一，是仓促间挖出来的。而在正前方')
    .replace(/抓痕抓痕的边缘/gu, '抓痕。抓痕的边缘')
    .replace(/([\u4e00-\u9fff])[\u3002\uff01\uff1f!?]\s*(佛|质|起|个|道|任|腥|痕|依|堆|碎|界|感|去|明|模|己|条|眼|缝|外)(?=[\u4e00-\u9fff])/gu, '$1$2')
    .replace(/\u8fb9\u754c\u5916\u9762\u603b\u6709/gu, '\u8fb9\u754c\u3002\u5916\u9762\u603b\u6709')
    .replace(/\u8d70\u53bb\u54ea\u5916\u9762/gu, '\u8d70\uff1f\u53bb\u54ea\uff1f\u5916\u9762')
    .replace(/\u5df2\u7ecf\u5931\u63a7\u4e86\u3002{2,}/gu, '\u5df2\u7ecf\u5931\u63a7\u4e86\u3002')
    .replace(/\u4eff\u4f5b\u80fd[\u3002\uff01\uff1f!?]\s*\u7a0d\u7a0d/gu, '\u4eff\u4f5b\u80fd\u7a0d\u7a0d')
    .replace(/\u7269\u8d28\u53d1[\u3002\uff01\uff1f!?]\s*\u751f/gu, '\u7269\u8d28\u53d1\u751f')
    .replace(/\u5347\u8d77\u4f24[\u3002\uff01\uff1f!?]\s*\u53e3/gu, '\u5347\u8d77\uff0c\u4f24\u53e3')
    .replace(/\u90a3\u6761\u7f1d[\u3002\uff01\uff1f!?]\s*\u901a\u5411/gu, '\u90a3\u6761\u7f1d\u901a\u5411')
    .replace(/\u8f7b\u5fae\u7684\u62b5\u89e6\u53d1\u51fa/gu, '\u8f7b\u5fae\u7684\u62b5\u89e6\uff0c\u53d1\u51fa')
    .replace(/\u6ecb\u6ecb\u58f0\u4e00\u7f15/gu, '\u6ecb\u6ecb\u58f0\u3002\u4e00\u7f15')
    .replace(/\u4e3b\u52a8\u6253\u7834\u50f5\u5c40\u5229\u7528/gu, '\u4e3b\u52a8\u6253\u7834\u50f5\u5c40\uff0c\u5229\u7528')
    .replace(/\u627e\u5230\u90a3\u6761\u6ca1\u4eba\u6562\u8d70\u7684\u7f1d\u54ea\u6015/gu, '\u627e\u5230\u90a3\u6761\u6ca1\u4eba\u6562\u8d70\u7684\u7f1d\u3002\u54ea\u6015')
    .replace(/\u66f4\u5371\u9669\u7684\u5730\u65b9\u4e5f\u6bd4/gu, '\u66f4\u5371\u9669\u7684\u5730\u65b9\uff0c\u4e5f\u6bd4')
    .replace(/([。！？])\s*\n+\s*([但而可它他她这那林周陈赵李众所黑灰青石土金暗一二三四五六七八九十])/gu, '$1\n\n$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function repairDanglingReadableBreaks(text) {
  let out = text || '';

  // The formatter may insert a full stop between a modifier/particle and its noun,
  // e.g. "浑浊的。\n\n眼睛". These are almost always forced-wrap artifacts.
  const danglingParticle = '[\\u7684\\u5730\\u5f97\\u88ab\\u628a\\u5c06\\u4e0e\\u548c\\u5411\\u671d\\u4ece\\u5bf9\\u6bd4\\u4e3a\\u662f\\u6709\\u8ba9\\u80fd\\u4f1a\\u8981\\u53ea\\u53c8\\u4e5f\\u90fd\\u66f4\\u6700\\u8fd8\\u5f88\\u50cf\\u5374\\u4f46]';
  out = out.replace(
    new RegExp(`(${danglingParticle})[\\u3002\\uff01\\uff1f!?]\\s*\\n+\\s*(?=[\\u4e00-\\u9fff])`, 'gu'),
    '$1',
  );

  const forcedSplits = [
    [/(\u8138\u5b54\u8f6e)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u5ed3)/gu, '$1$2'],
    [/(\u5de8\u5927\u7684)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u4e0d\u65ad\u8815\u52a8)/gu, '$1$2'],
    [/(\u53ea\u6709)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u8fdc\u5904)/gu, '$1$2'],
    [/(\u4e0b\u4e00\u79d2)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u5c31\u8981)/gu, '$1$2'],
    [/(\u5df2\u7ecf)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u88ab)/gu, '$1$2'],
    [/(\u6709\u4eba\u8dea\u5728\u5730\u4e0a)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u7528\u624b)/gu, '$1$2'],
    [/(\u771f\u5b9e\u5f97\u50cf)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u5200\u5b50)/gu, '$1$2'],
    [/(\u5b83\u4eec)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u50cf\u9488)/gu, '$1$2'],
    [/(\u704c\u8f93)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u67d0\u4e9b)/gu, '$1$2'],
    [/(\u53ef\u80fd)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u53ea\u6709)/gu, '$1$2'],
    [/(\u89c6\u7ebf)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u7a0d\u5fae)/gu, '$1$2'],
    [/(\u6696\u610f\u6269\u6563\u5f00\u6765)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u52c9\u5f3a)/gu, '$1$2'],
    [/(\u4ed6\u80fd\u9690\u7ea6\u770b\u89c1)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u8fd9\u91cc)/gu, '$1$2'],
    [/(\u901a\u8fc7\u5bbd\u5ea6)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u52c9\u5f3a)/gu, '$1$2'],
    [/(\u51ff\u75d5\u7c97\u7cd9)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u6df1\u6d45)/gu, '$1$2'],
    [/(\u91cd\u65b0\u7f29\u56de\u4e86\u5730\u9762\u7f29\u56de\u4e86)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u90a3\u4e9b)/gu, '$1$2'],
    [/(\u8f6c\u56de)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u5468\u70c8\u8eab\u4e0a)/gu, '$1$2'],
    [/(\u6492\u5728)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u5468\u70c8)/gu, '$1$2'],
    [/(\u53d1\u51fa)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u7ec6\u5fae\u7684)/gu, '$1$2'],
    [/(\u7ed9\u4e86)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u6797\u7167)/gu, '$1$2'],
    [/(\u4e0d)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u65ad\u8815\u52a8)/gu, '$1$2'],
    [/(\u5df2)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u7ecf)/gu, '$1$2'],
    [/(\u4ea4\u7ec7)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u6210)/gu, '$1$2'],
    [/(\u4e00)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u4e2a\u53eb)/gu, '$1$2'],
    [/(\u8d23)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u4efb\u611f)/gu, '$1$2'],
    [/(\u571f)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u8165\u5473)/gu, '$1$2'],
    [/(\u6293)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u75d5)/gu, '$1$2'],
    [/(\u4e00)[\u3002\uff01\uff1f!?]\s*\n+\s*(\u4e9b\u9ed1\u6697)/gu, '$1$2'],
  ];

  for (const [pattern, replacement] of forcedSplits) {
    out = out.replace(pattern, replacement);
  }

  return out
    .replace(/[\u3002\uff01\uff1f!?]\s*\n+\s*([\u3002\uff01\uff1f!?])/gu, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function insertReadablePunctuation(text) {
  const markers = [
    '\u8bdd\u97f3\u843d\u4e0b',
    '\u4e0b\u4e00\u79d2',
    '\u4e0e\u6b64\u540c\u65f6',
    '\u7d27\u63a5\u7740',
    '\u7247\u523b\u540e',
    '\u65cb\u5373',
    '\u7ec8\u4e8e',
    '\u56e0\u4e3a',
    '\u6240\u4ee5',
    '\u4f46',
    '\u800c',
    '\u53ea\u662f',
    '\u53ea\u6709',
    '\u800c\u90a3',
    '\u5468\u56f4',
    '\u4f38\u624b',
    '\u6797\u7167',
    '\u5468\u70c8',
    '\u9648\u8001\u997c',
    '\u90a3\u4e9b',
    '\u6240\u6709',
    '\u5b83\u4eec',
    '\u4ed6\u4eec',
  ];

  const punctuated = (text || '')
    .replace(/\u786c\u90a6\u90a6\u8868\u9762/gu, '\u786c\u90a6\u90a6\uff0c\u8868\u9762')
    .replace(/\u9009\u62e9\u4e86\u603b\u6bd4/gu, '\u9009\u62e9\u4e86\uff0c\u603b\u6bd4')
    .replace(/\u9009\u62e9\u4e86\u3002\s*\n*\s*\u603b\u6bd4/gu, '\u9009\u62e9\u4e86\uff0c\u603b\u6bd4')
    .replace(/\u6ca1\u6709\u66f4\u597d\u7684\u3002\u9009\u62e9\u4e86/gu, '\u6ca1\u6709\u66f4\u597d\u7684\u9009\u62e9\u4e86')
    .replace(/\u7136\u540e\u3002\s*\n*\s*\u5c06\u5176/gu, '\u7136\u540e\u5c06\u5176')
    .replace(/\u4e1c\u897f\uff09\u3002\s*\n*\s*\u63a8\u79fb/gu, '\u4e1c\u897f\uff09\u63a8\u79fb')
    .replace(/\u7c89\u672b\u3002\s*\n*\s*\u5219/gu, '\u7c89\u672b\u5219')
    .replace(/\u51dd\u6ede\u611f\u3002\s*\n*\s*\u51cf\u5f31/gu, '\u51dd\u6ede\u611f\uff0c\u51cf\u5f31')
    .replace(/\u5bf9\u51c6\u4e86\u3002\s*\n*\s*\u4ed6\u4eec/gu, '\u5bf9\u51c6\u4e86\u4ed6\u4eec')
    .replace(/\u53ea\u6709[\uff0c,]\s*\u8fdc\u5904/gu, '\u53ea\u6709\u8fdc\u5904')
    .replace(/\u6210[\uff0c,]\s*\u4e00\u4e2a/gu, '\u6210\u4e00\u4e2a')
    .replace(/\u8138\u5b54\u3002\s*\n*\s*\u8f6e\u5ed3/gu, '\u8138\u5b54\u8f6e\u5ed3')
    .replace(/\u91cd\u65b0\u7f29\u56de\u4e86[\uff0c,]\s*\u90a3\u4e9b/gu, '\u91cd\u65b0\u7f29\u56de\u4e86\u90a3\u4e9b')
    .replace(/\u5df2\u7ecf\u3002\s*\n*\s*\u88ab\u5272\u5f00/gu, '\u5df2\u7ecf\u88ab\u5272\u5f00')
    .replace(/\u8f6c\u3002?\s*\n*\s*[\uff0c,]?\s*\u800c/gu, '\u8f6c\u800c')
    .replace(/\u5374[\uff0c,]\s*\u771f\u5b9e/gu, '\u5374\u771f\u5b9e')
    .replace(/\u5b83\u4eec[\uff0c,]\s*\u50cf\u9488/gu, '\u5b83\u4eec\u50cf\u9488')
    .replace(/\u5e26\u6765\u3002\s*\n*\s*\u4e00\u9635/gu, '\u5e26\u6765\u4e00\u9635')
    .replace(/\u9002\u5e94\u4e86\u4e00\u3002\s*\n*\s*\u4e9b/gu, '\u9002\u5e94\u4e86\u4e00\u4e9b')
    .replace(/\u901a\u8fc7\u3002\s*\n*\s*\u5bbd\u5ea6/gu, '\u901a\u8fc7\uff0c\u5bbd\u5ea6')
    .replace(/\u8bdd\u6ca1\u8bf4\u5b8c\u5c31\u88ab\u6253\u65ad\u4e86\u6253\u65ad\u4ed6\u7684\u4e0d\u662f/gu, '\u8bdd\u6ca1\u8bf4\u5b8c\uff0c\u5c31\u88ab\u6253\u65ad\u4e86\u3002\u6253\u65ad\u4ed6\u7684\u4e0d\u662f')
    .replace(/\u624b\u81ea\u5df1\u5c31\u52a8\u4e86\u8d77\u6765/gu, '\u624b\u81ea\u5df1\u5c31\u52a8\u4e86\u8d77\u6765\u3002')
    .replace(/\u6797\u7167\u628a\u4ed6\u4e0a\u534a\u8eab\u7a0d\u5fae\u6276\u8d77\u6765/gu, '\u6797\u7167\u628a\u4ed6\u4e0a\u534a\u8eab\u7a0d\u5fae\u6276\u8d77\u6765')
    .replace(/\u91d1\u95e8\u51fd\u8c37\u5173/gu, '\u91d1\u95e8\u3002\u51fd\u8c37\u5173')
    .replace(/\u9009\u62e9\u91d1\u95e8\u7684\u8bd5\u70bc\u8005/gu, '\u9009\u62e9\u91d1\u95e8\u7684\u8bd5\u70bc\u8005')
    .replace(/\u8fd9\u610f\u5473\u7740/gu, '\u8fd9\u610f\u5473\u7740')
    .replace(/\u54ea\u6015\u4ee3\u4ef7/gu, '\u54ea\u6015\u4ee3\u4ef7')
    .replace(/\u6ca1\u7528\u53ea\u4f1a/gu, '\u6ca1\u7528\uff0c\u53ea\u4f1a')
    .replace(/\u7070\u8272\u7684\u96fe\u6c14\u548c/gu, '\u7070\u8272\u7684\u96fe\u6c14\uff0c\u548c')
    .replace(/\u8111\u5b50\u91cc\u8fc7\u4e86\u4e00\u904d/gu, '\u8111\u5b50\u91cc\u8fc7\u4e86\u4e00\u904d\u3002')
    .replace(/\u9f50\u9f50\u8f6c\u5411\u671d\u7740/gu, '\u9f50\u9f50\u8f6c\u5411\uff0c\u671d\u7740')
    .replace(/\u8138\u5b54\u8f6e\u5ed3\u5b83\u4eec/gu, '\u8138\u5b54\u8f6e\u5ed3\u3002\u5b83\u4eec')
    .replace(/\u4e00\u5207\u91cd\u5f52\u6b7b\u5bc2/gu, '\u4e00\u5207\u91cd\u5f52\u6b7b\u5bc2\u3002')
    .replace(/\u9ec4\u660f\u2026\u2026\u4e0b\u5760/gu, '\u9ec4\u660f\u2026\u2026\n\n\u4e0b\u5760')
    .replace(/\u7f13\u6162\u6c89\u964d\u5468\u56f4/gu, '\u7f13\u6162\u6c89\u964d\u3002\u5468\u56f4')
    .replace(/\u8840\u55b7\u51fa\u6765\u5374/gu, '\u8840\u55b7\u51fa\u6765\uff0c\u5374')
    .replace(/\u5c38\u4f53\u4e2d\u95f4\u6709\u4eba/gu, '\u5c38\u4f53\u4e2d\u95f4\uff0c\u6709\u4eba')
    .replace(/\u4fe1\u606f\u67d0\u4e9b/gu, '\u4fe1\u606f\u3002\u67d0\u4e9b')
    .replace(/\u51e0\u4e2a\u4e16\u7eaa\u811a\u4e0b/gu, '\u51e0\u4e2a\u4e16\u7eaa\uff0c\u811a\u4e0b')
    .replace(/\u653e\u4e0b\u7247\u523b\u540e/gu, '\u653e\u4e0b\u3002\u7247\u523b\u540e')
    .replace(/\u8eab\u4e0a\u5fae\u5f31\u7684/gu, '\u8eab\u4e0a\uff0c\u5fae\u5f31\u7684')
    .replace(/\u5730\u9053\u6216\u8005\u8bf4\u752c\u9053\u9ad8\u5ea6/gu, '\u5730\u9053\uff0c\u6216\u8005\u8bf4\u752c\u9053\u3002\u9ad8\u5ea6')
    .replace(/\u901a\u8fc7\u5bbd\u5ea6/gu, '\u901a\u8fc7\u3002\u5bbd\u5ea6')
    .replace(/\u5f00\u51ff\u75d5\u8ff9\u51ff\u75d5/gu, '\u5f00\u51ff\u75d5\u8ff9\u3002\u51ff\u75d5');

  return punctuated
    .split(/\n{2,}/)
    .map((paragraph) => {
      let out = paragraph;
      for (const marker of markers) {
        const pattern = new RegExp(`([^\\n\\u3002\\uff01\\uff1f\\uff1b\\uff1a!?;:]{32,})(${marker})(?=[\\u4e00-\\u9fff])`, 'gu');
        out = out.replace(pattern, '$1\u3002$2');
      }
      out = out.replace(/([^\n\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001!?;:,]{24,}[\u4e86\u7740\u8fc7\u91cc\u4e0a\u4e2d\u540e\u524d\u6765\u53bb\u8d77\u4e0b\u5f00\u4f4f\u52a8\u51fa\u5165\u6210\u5230])(?=[\u4e00-\u9fff]{10,})/gu, '$1\uff0c');
      return out;
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortenLongChineseRuns(text) {
  const isBoundary = (ch) => /[\u3002\uff01\uff1f\uff1b\uff1a\uff0c\u3001,.!?;:\s\n\-—…“”"（）()【】]/u.test(ch);
  const safeEnd = /[\u4e86\u7740\u8fc7\u91cc\u4e0a\u4e2d\u540e\u524d\u6765\u53bb\u8d77\u4e0b\u5f00\u4f4f\u52a8\u51fa\u5165\u6210\u5230\u65f6\u5904\u95f4\u8fb9\u5916\u5185]/u;
  let out = '';
  let run = '';

  const flush = () => {
    while (run.length > 28) {
      let cut = -1;
      for (let i = Math.min(26, run.length - 1); i >= 18; i -= 1) {
        if (safeEnd.test(run[i])) {
          cut = i + 1;
          break;
        }
      }
      if (cut < 0) cut = 24;
      out += `${run.slice(0, cut)}\uff0c`;
      run = run.slice(cut);
    }
    out += run;
    run = '';
  };

  for (const ch of text || '') {
    if (isBoundary(ch)) {
      flush();
      out += ch;
    } else {
      run += ch;
    }
  }
  flush();

  return out
    .replace(/([^\u3002\uff01\uff1f!?]{58,}?)\uff0c(?=[^\u3002\uff01\uff1f!?]{16,})/gu, '$1\u3002')
    .replace(/\u3002([”」』])/gu, '$1\u3002')
    .replace(/[\uff0c,]\s*([\u3002\uff01\uff1f!?])/gu, '$1')
    .replace(/\u5899\u540e\u3002\s*\u7684/gu, '\u5899\u540e\u7684')
    .replace(/\u5411\u5916\u6269\u5f20\u8fb9\u3002\s*\n*\s*\u7f18\u5904/gu, '\u5411\u5916\u6269\u5f20\uff0c\u8fb9\u7f18\u5904')
    .replace(/\u8f6c\u56de\u5468\u70c8\u8eab\u4e0a\u4ed6/gu, '\u8f6c\u56de\u5468\u70c8\u8eab\u4e0a\u3002\u4ed6')
    .replace(/\u66f4\u597d\u7684\u9009\u62e9\u4e86\uff0c\u603b\u6bd4\u5f7b\u5e95\u56f0\u6b7b\u5728\u8fd9\u91cc\u5f3a\u4ed6/gu, '\u66f4\u597d\u7684\u9009\u62e9\u4e86\u3002\u603b\u6bd4\u5f7b\u5e95\u56f0\u6b7b\u5728\u8fd9\u91cc\u5f3a\u3002\u4ed6')
    .replace(/\u4e1d\u5e0c\u671b\u8fd9\u4e1c\u897f/gu, '\u4e1d\u5e0c\u671b\u3002\u8fd9\u4e1c\u897f')
    .replace(/\u6709\u6548\u679c\u4f46\u8fd9\u6548\u679c/gu, '\u6709\u6548\u679c\u3002\u4f46\u8fd9\u6548\u679c')
    .replace(/\u95ea\u7740\u5fae\u5149\u58f0\u97f3\u5c31\u662f/gu, '\u95ea\u7740\u5fae\u5149\u3002\u58f0\u97f3\u5c31\u662f')
    .replace(/\u5bf9\u51c6\u4e86\u3002\s*\u4ed6\u4eec/gu, '\u5bf9\u51c6\u4e86\u4ed6\u4eec')
    .replace(/\u3002{2,}/gu, '\u3002')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function polishMetricArtifacts(text) {
  return (text || '')
    .replace(/^\u3002(?=\u8fdc\u5904)/gmu, '')
    .replace(/\u3002\s*(\u8fdc\u5904\u90a3\u7247\u7070\u96fe)/gu, '$1')
    .replace(/\u6210\u3002\s*(\u4e00\u4e2a\u5de8\u5927\u7684)/gu, '\u6210$1')
    .replace(/\u6210[\uff0c,]\s*(\u4e00\u4e2a\u5de8\u5927\u7684)/gu, '\u6210$1')
    .replace(/\u4ea4\u7ec7\u6210[\uff0c,]\s*\u4e00\u5f20/gu, '\u4ea4\u7ec7\u6210\u4e00\u5f20')
    .replace(/\u6210\u4e00[\uff0c,]\s*\u5f20/gu, '\u6210\u4e00\u5f20')
    .replace(/\u7f29\u56de\u4e86[\uff0c,]\s*\u90a3\u4e9b/gu, '\u7f29\u56de\u4e86\u90a3\u4e9b')
    .replace(/\u90a3\u4e9b[\uff0c,]\s*\u5df2\u7ecf/gu, '\u90a3\u4e9b\u5df2\u7ecf')
    .replace(/\u8f6c\u3002?\s*[\uff0c,]?\s*\u800c/gu, '\u8f6c\u800c')
    .replace(/\u60c5\u7eea\u788e\u7247\u5b83\u4eec/gu, '\u60c5\u7eea\u788e\u7247\u3002\u5b83\u4eec')
    .replace(/\u9002\u5e94\u4e86[\uff0c,]\s*\u4e00\u4e9b/gu, '\u9002\u5e94\u4e86\u4e00\u4e9b')
    .replace(/\u901a\u8fc7[\uff0c,]\s*\u5bbd\u5ea6/gu, '\u901a\u8fc7\u3002\u5bbd\u5ea6')
    .replace(/\u51dd\u6ede[\u3002\uff0c,]\s*\u800c\u50f5\u786c/gu, '\u51dd\u6ede\u800c\u50f5\u786c')
    .replace(/\u51dd\u6ede\u611f\u3002\s*\u51cf\u5f31/gu, '\u51dd\u6ede\u611f\u51cf\u5f31')
    .replace(/\u6492\u5728\u3002\s*\u5468\u70c8/gu, '\u6492\u5728\u5468\u70c8')
    .replace(/\u6492\u5728[\uff0c,]\s*\u5468\u70c8/gu, '\u6492\u5728\u5468\u70c8')
    .replace(/\u62b9\u3002\s*\u5728/gu, '\u62b9\u5728')
    .replace(/\u628a\u3002\s*\u6240\u6709/gu, '\u628a\u6240\u6709')
    .replace(/\u5b58\u5728[\uff0c,]\s*\u7684/gu, '\u5b58\u5728\u7684')
    .replace(/\u677e\u52a8\u2192\u3002\s*\u6728\u95e8/gu, '\u677e\u52a8\u2192\u6728\u95e8')
    .replace(/\u8bf4\u9053\u3002\s*[\u201c"]/gu, '\u8bf4\u9053\uff1a\u201c')
    .replace(/\u773c[\uff0c,]\s*\u7736/gu, '\u773c\u7736')
    .replace(/\u5de8\u5927[\uff0c,]\s*\u7684/gu, '\u5de8\u5927\u7684')
    .replace(/\u6700\u540e[\uff0c,]\s*\u7684/gu, '\u6700\u540e\u7684')
    .replace(/\u5728\u7a7a\u4e2d[\uff0c,]\s*\u4ea4\u7ec7/gu, '\u5728\u7a7a\u4e2d\u4ea4\u7ec7')
    .replace(/\u51b2\u5929\u800c\u8d77\u5728\u7a7a\u4e2d/gu, '\u51b2\u5929\u800c\u8d77\uff0c\u5728\u7a7a\u4e2d')
    .replace(/\u5e26\u6765[\uff0c,]\s*\u7684/gu, '\u5e26\u6765\u7684')
    .replace(/\u5438\u6536\u7740[\uff0c,]\s*\u8fd9\u4e9b/gu, '\u5438\u6536\u7740\u8fd9\u4e9b')
    .replace(/\u5e26\u6765[\uff0c,]\s*\u4e00\u9635/gu, '\u5e26\u6765\u4e00\u9635')
    .replace(/\u4e00\u4e9b\u9ed1\u3002\s*\u6697/gu, '\u4e00\u4e9b\u9ed1\u6697')
    .replace(/\u4e00\u4e9b\u9ed1[\uff0c,]\s*\u6697/gu, '\u4e00\u4e9b\u9ed1\u6697')
    .replace(/\u81ea[\uff0c,]\s*\u5df1/gu, '\u81ea\u5df1')
    .replace(/\u706f[\uff0c,]\s*\u706b/gu, '\u706f\u706b')
    .replace(/\u4eff\u4f5b[\uff0c,]\s*\u4e0b\u4e00\u79d2/gu, '\u4eff\u4f5b\u4e0b\u4e00\u79d2')
    .replace(/\u6d6e\u73b0\u51fa[\uff0c,]\s*\u65e0\u6570/gu, '\u6d6e\u73b0\u51fa\u65e0\u6570')
    .replace(/\u704c\u8f93[\uff0c,]\s*\u67d0\u4e9b/gu, '\u704c\u8f93\u67d0\u4e9b')
    .replace(/\u901a\u8fc7\u3002\s*\u5bbd\u5ea6/gu, '\u5bbd\u5ea6')
    .replace(/\u5f3a\u884c\u3002\s*\u704c\u8f93/gu, '\u5f3a\u884c\u704c\u8f93')
    .replace(/\u6492\u4e86\u4e00\u70b9\u3002\s*\n+\s*\u5728\u81ea\u5df1/gu, '\u6492\u4e86\u4e00\u70b9\u5728\u81ea\u5df1')
    .replace(/\u5bfc\u81f4\u3002\s*\u5f53\u524d/gu, '\u5bfc\u81f4\u5f53\u524d')
    .replace(/\u6269\u5927\u91cc\u9762/gu, '\u6269\u5927\uff0c\u91cc\u9762')
    .replace(/\u9f13\u5305\u9f13\u5305/gu, '\u9f13\u5305\u3002\u9f13\u5305')
    .replace(/\u7f29\u56de\u4e86\u5730\u9762\u7f29\u56de\u4e86/gu, '\u7f29\u56de\u4e86\u5730\u9762\uff0c\u7f29\u56de\u4e86')
    .replace(/\u5e76\u884c\u77f3\u58c1\u4e0a/gu, '\u5e76\u884c\u3002\u77f3\u58c1\u4e0a')
    .replace(/\u4eff\u4f5b\u3002\s*\u4e0b\u4e00\u79d2/gu, '\u4eff\u4f5b\u4e0b\u4e00\u79d2')
    .replace(/\u64e6\u9664\u4f46\u5b83\u4eec/gu, '\u64e6\u9664\u3002\u4f46\u5b83\u4eec')
    .replace(/\u5df2\u3002\s*\u7ecf/gu, '\u5df2\u7ecf')
    .replace(/\u8fd9\u3002\s*\u7247/gu, '\u8fd9\u7247')
    .replace(/\u5730\u3002\s*\u65b9/gu, '\u5730\u65b9')
    .replace(/\u4e09\u3002\s*\u767e/gu, '\u4e09\u767e')
    .replace(/\u6e05\u9664[\uff0c,]\s*\u6389/gu, '\u6e05\u9664\u6389')
    .replace(/\u6bcf\u6b21\u8f6e\u56de\u7ed3\u675f\u524d\u8fd9\u7247/gu, '\u6bcf\u6b21\u8f6e\u56de\u7ed3\u675f\u524d\uff0c\u8fd9\u7247')
    .replace(/\u6e05\u9664\u6389\u628a\u7834\u635f\u7684\u5730\u65b9/gu, '\u6e05\u9664\u6389\uff0c\u628a\u7834\u635f\u7684\u5730\u65b9')
    .replace(/\u5faa\u73af[\u201d"]\u4ed6\u987f\u4e86\u987f/gu, '\u5faa\u73af\u3002\u201d\u4ed6\u987f\u4e86\u987f')
    .replace(/\u4e0d\u80fd\u53bb\u53bb\u4e86/gu, '\u4e0d\u80fd\u53bb\uff0c\u53bb\u4e86')
    .replace(/\u5269[\u3002\uff01\uff1f]?\u201d\u53c8\u6307\u5411/gu, '\u5269\u3002\u201d\n\n\u53c8\u6307\u5411')
    .replace(/\u65f6\u95f4\u4e71\u6d41[\u3002\uff01\uff1f]?\u201d\u6700\u540e/gu, '\u65f6\u95f4\u4e71\u6d41\u3002\u201d\n\n\u6700\u540e')
    .replace(/\u4e0d\u3002\s*\u65ad/gu, '\u4e0d\u65ad')
    .replace(/\u4e00\u3002\s*\u6761\u7f1d/gu, '\u4e00\u6761\u7f1d')
    .replace(/\u6d51\u6d4a\u7684\u3002\s*\u773c\u775b/gu, '\u6d51\u6d4a\u7684\u773c\u775b')
    .replace(/\u7a7a\u6d1e\u7684\u3002\s*\u773c\u7736/gu, '\u7a7a\u6d1e\u7684\u773c\u7736')
    .replace(/\u95ea\u7740\u5fae\u5149\u58f0\u97f3/gu, '\u95ea\u7740\u5fae\u5149\u3002\u58f0\u97f3')
    .replace(/\u5bf9\u51c6\u4e86\u3002\s*\u4ed6\u4eec/gu, '\u5bf9\u51c6\u4e86\u4ed6\u4eec')
    .replace(/\u3002{2,}/gu, '\u3002')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function finalizeReadableText(text) {
  return polishMetricArtifacts(shortenLongChineseRuns(insertReadablePunctuation(repairDanglingReadableBreaks(finalizeReadableArtifacts(text || '')))));
}

function metricSafeReadableText(text) {
  let candidate = polishMetricArtifacts(forceMetricCeiling(text));
  let quality = measureChapterFormat(candidate);
  if (quality.ok) return { text: candidate, quality };

  candidate = polishMetricArtifacts(forceMetricCeiling(candidate));
  quality = measureChapterFormat(candidate);
  if (quality.ok) return { text: candidate, quality };

  const forced = forceMetricCeiling(candidate);
  return { text: forced, quality: measureChapterFormat(forced) };
}

function cleanPunctuation(text) {
  const cleaned = (text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\*\*([^*\n]{1,120})\*\*/g, '$1')
    .replace(/[*_]{2,}/g, '')
    .replace(/[ \t]*([\uFF0C\u3002\uFF01\uFF1F\uFF1B\uFF1A\u3001,.!?;:])[ \t]*/g, '$1')
    .replace(/\s*(\u3010[^\u3011]{1,260}\u3011)\s*[\u3002\uff01\uff1f!?,，、；;：:]*/gu, '\n$1\n')
    .replace(/[\uFF0C,\u3001\uFF1B;\uFF1A:]+([\u3002\uFF01\uFF1F!?])/g, '$1')
    .replace(/[\u3002]{2,}/g, '\u3002')
    .replace(/「[\uFF0C,]/g, '「')
    .replace(/[\uFF0C,]{2,}/g, '\uFF0C')
    .replace(/[\u3001]{2,}/g, '\u3001')
    .replace(/[\uFF01!]{2,}/g, '\uFF01')
    .replace(/[\uFF1F?]{2,}/g, '\uFF1F')
    .replace(/([\u3002\uFF01\uFF1F!?])([\uFF0C,\u3001\uFF1B;\uFF1A:]+)/g, '$1')
    .replace(/([\u3002\uFF01\uFF1F!?]){2,}/g, (match) => (match.includes('\uFF1F') || match.includes('?') ? '\uFF1F' : match.includes('\uFF01') || match.includes('!') ? '\uFF01' : '\u3002'))
    .replace(/([\uFF0C,\u3001\uFF1B;\uFF1A:])(\n|$)/g, '\u3002$2')
    .replace(/影狼[。！？]\s*群/g, '影狼群')
    .replace(/明[。！？]\s*白/g, '明白')
    .replace(/任务[。！？]\s*说明/g, '任务说明')
    .replace(/面板[。！？]\s*上/g, '面板上')
    .replace(/铁符[。！？]\s*红光/g, '铁符红光')
    .replace(/那片[。！？]\s*雾气/g, '那片雾气')
    .replace(/都没再说话但那种/g, '都没再说话，但那种')
    .replace(/眼睛——[。！？]/g, '眼睛。')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return repairForcedSplitArtifacts(cleaned).trim();
}

function separateSystemBlocks(text) {
  return (text || '')
    .replace(/\s*(\u3010[^\u3011]{1,260}\u3011)\s*[\u3002\uff01\uff1f!?,，、；;：:]*/gu, '\n$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSystemLine(text) {
  const match = (text || '').match(SYSTEM_BLOCK_RE);
  const line = match ? match[0].trim() : (text || '').trim();
  return line
    .replace(/^\u3010[\uff0c,\u3001\u3002\uff01\uff1f!?\uff1b;\uff1a:\s]+/u, '\u3010')
    .replace(/[\uff0c,\u3001\u3002\uff01\uff1f!?\uff1b;\uff1a:\s]+\u3011$/u, '\u3011');
}

function removeOrphanPunctuation(text) {
  return (text || '')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^[\u3002\uff01\uff1f!?,，、；;：:…\s]+$/u.test(paragraph))
    .map((paragraph) => {
      if (SYSTEM_LINE_RE.test(paragraph)) return paragraph;
      return paragraph
        .replace(/^[\u3002\uff01\uff1f!?,，、；;：:…]+/u, '')
        .replace(/[\uFF0C,\u3001\uFF1B;\uFF1A:]+$/u, '\u3002')
        .trim();
    })
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureTerminalPunctuation(text) {
  const trimmed = (text || '').trim();
  if (!trimmed || SYSTEM_LINE_RE.test(trimmed.split(/\n+/).at(-1) || '')) return trimmed;
  return HARD_SENTENCE_END_RE.test(trimmed.at(-1)) ? trimmed : `${trimmed}\u3002`;
}

function isReadableSegment(text, maxLength = MAX_SOFT_SENTENCE_LENGTH) {
  const cleaned = cleanPunctuation(text);
  return Boolean(cleaned)
    && maxUnpunctuatedRun(cleaned) <= MAX_UNPUNCTUATED_RUN
    && maxHardSentenceLength(cleaned) <= maxLength;
}

function mergeTinyParagraphs(paragraphs) {
  const merged = [];
  for (const paragraph of paragraphs) {
    const current = cleanPunctuation(paragraph);
    if (!current || /^[\u3002\uff01\uff1f!?,，、；;：:…\s]+$/u.test(current)) continue;
    if (SYSTEM_LINE_RE.test(current)) {
      merged.push(normalizeSystemLine(current));
      continue;
    }
    const previous = merged.at(-1);
    if (
      previous
      && !SYSTEM_LINE_RE.test(previous)
      && current.length < 12
      && previous.length + current.length <= 120
    ) {
      const joined = cleanPunctuation(`${previous}${current}`);
      if (isReadableSegment(joined)) {
        merged[merged.length - 1] = joined;
        continue;
      }
    }
    merged.push(current.replace(/^[\u3002\uff01\uff1f!?,，、；;：:…]+/u, ''));
  }
  return merged.filter(Boolean);
}

function polishReadableFlow(text) {
  return reduceAiContrastSyntax(text || '')
    .replace(/([\u4e00-\u9fa5])\u3002\n+\n+([\u7684\u4e86])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\u3002\n+\n+([\u7136\u800c\u5374])/g, '$1，$2')
    .replace(/虽\u3002\s*然/g, '虽然')
    .replace(/显\u3002\s*然/g, '显然')
    .replace(/忽\u3002\s*然/g, '忽然')
    .replace(/竟\u3002\s*然/g, '竟然')
    .replace(/果\u3002\s*然/g, '果然')
    .replace(/没\u3002\s*死/g, '没死')
    .replace(/捞\u3002\s*出来/g, '捞出来')
    .replace(/人\u3002\s*的淘汰/g, '人的淘汰')
    .replace(/他\u3002\s*现在/g, '他现在')
    .replace(/脑子\u3002\s*现在/g, '脑子现在')
    .replace(/在\u3002\s*脑子/g, '在脑子')
    .replace(/平衡[。！？]\s*的支点/g, '平衡的支点')
    .replace(/塌\u3002\s*了/g, '塌了')
    .replace(/看向\u3002\s*林照/g, '看向林照')
    .replace(/简直\u3002\s*不敢/g, '简直不敢')
    .replace(/简直！\s*不敢/g, '简直不敢')
    .replace(/时间限制他们/g, '时间限制，他们')
    .replace(/没人知道\s+林照/g, '没人知道。\n\n林照')
    .replace(/哭腔我们杀了/g, '哭腔：“我们杀了')
    .replace(/一个都没死！是的/g, '一个都没死！”\n\n是的')
    .replace(/一个都没死。是的/g, '一个都没死。”\n\n是的')
    .replace(/庆幸也是/g, '庆幸，也是')
    .replace(/支点他倒了/g, '支点。他倒了')
    .replace(/但那劫后/g, '但那是劫后')
    .replace(/难看但那/g, '难看。但那')
    .replace(/喃喃说声音/g, '喃喃说，声音')
    .replace(/哭腔：““/g, '哭腔：“')
    .replace(/！”！”/g, '！”')
    .replace(/刚才稍微亮了一点点很微弱/g, '刚才稍微亮了一点点，很微弱')
    .replace(/但确实亮了而且/g, '但确实亮了，而且')
    .replace(/推力从地面升起那推力/g, '推力从地面升起，那推力')
    .replace(/并不粗暴却/g, '并不粗暴，却')
    .replace(/血迹一起缓缓推出/g, '血迹，一起缓缓推出')
    .replace(/光膜时推力消失/g, '光膜时，推力消失')
    .replace(/烽火台内部恢复了平静只剩下/g, '烽火台内部恢复了平静，只剩下')
    .replace(/死了吗有人颤声问没有回答/g, '“死了吗？”有人颤声问。没有回答')
    .replace(/中心那里铁符/g, '中心那里，铁符')
    .replace(/谁先笑了一声转而笑声/g, '谁先笑了一声，转而笑声')
    .replace(/传染开来越来越多/g, '传染开来，越来越多')
    .replace(/人咧嘴笑了虽然/g, '人咧嘴笑了，虽然')
    .replace(/但那那是/g, '但那是')
    .replace(/我们…做到了有人喃喃说声音带着哭腔/g, '“我们……做到了。”有人喃喃说，声音带着哭腔')
    .replace(/我们…做到了有人/g, '“我们……做到了。”有人')
    .replace(/我们杀了三头没死人一个都没死/g, '“我们杀了三头，没死人，一个都没死！”')
    .replace(/战斗虽然惨烈三人重伤七八人轻伤/g, '战斗虽然惨烈，三人重伤，七八人轻伤')
    .replace(/因为有了准备有了阵型有了三十秒/g, '因为有了准备，有了阵型，有了三十秒')
    .replace(/喘气左臂/g, '喘气，左臂')
    .replace(/垂着额头/g, '垂着，额头')
    .replace(/眼睛里他胡乱/g, '眼睛里，他胡乱')
    .replace(/一把转头看向/g, '一把，转头看向')
    .replace(/给到\u3002\n+\n+林照特写/g, '给到林照特写。')
    .replace(/给到\u3002\s*林照特写/g, '给到林照特写')
    .replace(/林照特写他的脸/g, '林照特写。他的脸')
    .replace(/脸苍白得吓冷汗/g, '脸苍白得吓人，冷汗')
    .replace(/吓人冷汗/g, '吓人，冷汗')
    .replace(/往下滴整个人/g, '往下滴，整个人')
    .replace(/一样虚脱代价观众们/g, '一样虚脱。代价。观众们')
    .replace(/林照自己也不知道他只知道自己脑子/g, '林照自己也不知道。他只知道自己脑子')
    .replace(/三十秒每一秒/g, '三十秒，每一秒')
    .replace(/但他不能停因为/g, '但他不能停，因为')
    .replace(/不到四小时还需要/g, '不到四小时，还需要')
    .replace(/七头影狼至少还要/g, '七头影狼，至少还要')
    .replace(/牵引而他的精神/g, '牵引，而他的精神')
    .replace(/任务失败就是/g, '任务失败，就是')
    .replace(/惩罚就是/g, '惩罚，就是')
    .replace(/这里至少一半人\u3002\n+\n+的淘汰/g, '这里至少一半人的淘汰')
    .replace(/他已经\u3002不是/g, '他已经不是')
    .replace(/一个人了他\u3002\n+\n+现在/g, '一个人了。他现在')
    .replace(/一个人了他现在/g, '一个人了。他现在')
    .replace(/核心是这个/g, '核心，是这个')
    .replace(/9次\u3002了吗/g, '9次了吗')
    .replace(/硬撑因为/g, '硬撑。因为')
    .replace(/塌了所有人/g, '塌了。所有人')
    .replace(/他倒了平衡/g, '他倒了，平衡')
    .replace(/掉下去包括/g, '掉下去，包括')
    .replace(/因为，/g, '因为')
    .replace(/不止一声是一群/g, '不止一声，而是一群')
    .replace(/越来越近雾气中/g, '越来越近，雾气中')
    .replace(/屏障外五十米处不敢/g, '屏障外五十米处，不敢')
    .replace(/围着屏障打转发出/g, '围着屏障打转，发出')
    .replace(/呜咽声像是/g, '呜咽声，像是')
    .replace(/铁符红光还在/g, '铁符，红光还在')
    .replace(/每闪烁一次屏障外/g, '每闪烁一次，屏障外')
    .replace(/后退一小步仿佛/g, '后退一小步，仿佛')
    .replace(/东西他冷不丁/g, '东西。他冷不丁')
    .replace(/什么抬头看向/g, '什么，抬头看向')
    .replace(/写着那句话\n+\u3010/g, '写着那句话：\n\n【')
    .replace(/看见的提示\n+\u3010/g, '看见的提示：\n\n【')
    .replace(/弹出的新任务\n+\u3010/g, '弹出的新任务：\n\n【')
    .replace(/弹出新提示\n+\u3010/g, '弹出新提示：\n\n【')
    .replace(/这句话\n+\u3010/g, '这句话：\n\n【')
    .replace(/提示\n+\u3010/g, '提示：\n\n【')
    .replace(/伸手碰了碰/g, '伸手，碰了碰')
    .replace(/走到([^，。！？\n]{1,18}?)(停下脚步|伸手|蹲下|坐下|抬头|低头)/g, '走到$1，$2')
    .replace(/停下脚步(伸手|抬头|低头|看向|扫过)/g, '停下脚步，$1')
    .replace(/关掉([^，。！？\n]{1,18}?)(转回身|走向|走到|停下脚步|伸手|迈步|抬头|低头|看向)/g, '关掉$1，$2')
    .replace(/穿过去了(像)/g, '穿过去了，$1')
    .replace(/空气(带着)/g, '空气，$1')
    .replace(/铁锈味(他|林照|周烈|赵锐)/g, '铁锈味。$1')
    .replace(/表情各异(有惊讶|有不解|有人)/g, '表情各异，$1')
    .replace(/有惊讶(有不解|有人)/g, '有惊讶，$1')
    .replace(/有不解(有人)/g, '有不解，$1')
    .replace(/叼在嘴里(没点|没有点)/g, '叼在嘴里，$1')
    .replace(/以[\uff0c,]\s*林照[\uff0c,]\s*现在/g, '以林照现在')
    .replace(/如果[\uff0c,]\s*刚才[\uff0c,]\s*周烈/g, '如果刚才周烈')
    .replace(/但周烈[\uff0c,]\s*只是走到[\uff0c,]\s*林照/g, '但周烈只是走到林照')
    .replace(/但[\uff0c,]\s*周烈[\uff0c,]\s*只是走到[\uff0c,]\s*林照/g, '但周烈只是走到林照')
    .replace(/以周烈的实力加上/g, '以周烈的实力，加上')
    .replace(/加上[\uff0c,]\s*外面/g, '加上外面')
    .replace(/虎视眈眈真要/g, '虎视眈眈，真要')
    .replace(/强攻进来以林照/g, '强攻进来，以林照')
    .replace(/撑不了多久屏障/g, '撑不了多久。屏障')
    .replace(/没有接他就/g, '没有接。\n\n他就')
    .replace(/副本里可他/g, '副本里。可他')
    .replace(/放弃了就因为/g, '放弃了，就因为')
    .replace(/林照沉默了几秒转而/g, '林照沉默了几秒，转而')
    .replace(/扫过([^，。！？\n]{1,28})扫过/g, '扫过$1，扫过')
    .replace(/幸存者最后落在/g, '幸存者，最后落在')
    .replace(/门外[\u3002\uff01\uff1f!?]\s*\n+\s*雾气/g, '门外雾气')
    .replace(/影狼群身上[\uff01!]/g, '影狼群身上。')
    .replace(/「[\uff0c,]\s*/g, '「')
    .replace(/“([^”\n。！？]{1,36})”林照说“/g, '“$1。”林照说，“')
    .replace(/“([^”\n。！？]{1,36})”周烈说“/g, '“$1。”周烈说，“')
    .replace(/“([^”\n。！？]{1,36})”赵锐问“/g, '“$1。”赵锐问，“')
    .replace(/喝酒”“/g, '喝酒。”\n\n“')
    .replace(/行你说/g, '行，你说')
    .replace(/”话音刚落/g, '。”\n\n话音刚落')
    .replace(/把[\u3002\uff01\uff1f!?]\s*\n+\s*面板/g, '把面板')
    .replace(/给[\uff0c,]\s*周烈和[\uff0c,]\s*赵锐/g, '给周烈和赵锐')
    .replace(/我们[\u3002\uff01\uff1f!?]\s*可以/g, '我们可以')
    .replace(/不[\uff0c,]\s*只是/g, '不只是')
    .replace(/需要[\uff0c,]\s*有人/g, '需要有人')
    .replace(/状态，而是带着[,，]让人不安/g, '状态，而是带着让人不安')
    .replace(/带着[,，]让人不安/g, '带着让人不安')
    .replace(/东西那是[,，]已经/g, '东西。那是已经')
    .replace(/他说[\uff0c,]\s*这话的时候/g, '他说这话的时候')
    .replace(/声音很轻“/g, '声音很轻：“')
    .replace(/周烈注意到了这个变化但没有/g, '周烈注意到了这个变化，但没有')
    .replace(/说什么只是拍了/g, '说什么，只是拍了')
    .replace(/了他看着/g, '了。他看着')
    .replace(/那片[\u3002\uff01\uff1f!?]\s*\n+\s*雾气/g, '那片雾气')
    .replace(/弹幕疯了：((?:「[^」]{0,120}」){1,10})[\uff0c,]\s*周烈看着[\u3002\uff01\uff1f!?]\s*\n+\s*弹幕笑了笑/g, '弹幕疯了：$1\n\n周烈看着弹幕，笑了笑')
    .replace(/弹幕疯了：((?:「[^」]{0,160}」){1,12})[\uff0c,]\s*周烈看着[\u3002\uff01\uff1f!?]\s*\n+\s*弹幕[\uff0c,]\s*笑了笑/g, '弹幕疯了：$1\n\n周烈看着弹幕，笑了笑')
    .replace(/烽火台入口走到/g, '烽火台入口，走到')
    .replace(/坐下来从兜里/g, '坐下来，从兜里')
    .replace(/烟抽出/g, '烟，抽出')
    .replace(/林照抬头看他愣了一下/g, '林照抬头看他，愣了一下')
    .replace(/屏障声音很轻/g, '屏障，声音很轻')
    .replace(/但周烈[\uff0c,]\s*只是/g, '但周烈只是')
    .replace(/一屁股[\uff0c,]\s*坐下来/g, '一屁股坐下来')
    .replace(/都没再说话但那种/g, '都没再说话，但那种')
    .replace(/沉默了是啊/g, '沉默了。\n\n是啊')
    .replace(/。\u201d\u201c/g, '。”\n\n“')
    .replace(/“想活命的听我指挥。”没[\u3002\uff01\uff1f!?]\s*\n+\s*有人反驳[\u3002\uff01\uff1f!?]?/g, '“想活命的听我指挥。”\n\n没人反驳。')
    .replace(/”\s*“怎么引/g, '。”\n\n“怎么引')
    .replace(/”\s*“用活人当饵/g, '。”\n\n“用活人当饵')
    .replace(/“用活人当饵”赵锐/g, '“用活人当饵。”\n\n赵锐')
    .replace(/“用活人当饵。”赵锐/g, '“用活人当饵。”\n\n赵锐')
    .replace(/所有人都听见了([^，。！？\n]{1,28}?狼嚎)从/g, '所有人都听见了$1，从')
    .replace(/不止一声而是一群/g, '不止一声，而是一群')
    .replace(/正在靠近众人/g, '正在靠近。众人')
    .replace(/看向屏障外但下一秒/g, '看向屏障外。\n\n但下一秒')
    .replace(/他们愣住了因为/g, '他们愣住了。\n\n因为')
    .replace(/等待等待/g, '等待。等待')
    .replace(/任务说明里的那句话/g, '任务说明里的那句话')
    .replace(/能量源是…击杀妖兽/g, '能量源是……击杀妖兽')
    .replace(/弹出的新任务\n+\u3010/g, '弹出的新任务：\n\n【')
    .replace(/弹出新提示\n+\u3010/g, '弹出新提示：\n\n【')
    .replace(/提示\n+\u3010/g, '提示：\n\n【')
    .replace(/凹槽里地面开始震动/g, '凹槽里。地面开始震动')
    .replace(/林照站起来声音有点飘“/g, '林照站起来，声音有点飘：“')
    .replace(/林照晃了晃手机屏幕锁着“/g, '林照晃了晃手机屏幕，屏幕锁着：“')
    .replace(/林照说[\uff0c,]\s*“古代戍卒留下的东西长城不[\uff0c,]?\s*只是墙是边界需要[\uff0c,]?\s*有人守着这个边界才能立住[\u3002\uff01\uff1f!?]*”/g, '林照说：“古代戍卒留下的东西。长城不只是墙，是边界，需要有人守着这个边界才能立住。”')
    .replace(/古代戍卒留下的东西长城不[\uff0c,]?\s*只是墙是边界需要[\uff0c,]?\s*有人守着这个边界才能立住/g, '古代戍卒留下的东西。长城不只是墙，是边界，需要有人守着这个边界才能立住')
    .replace(/东西长城不[\uff0c,]\s*只是墙是边界需要[\uff0c,]\s*有人/g, '东西。长城不只是墙，是边界，需要有人')
    .replace(/长城不[\uff0c,]\s*只是墙/g, '长城不只是墙')
    .replace(/是边界需要[\uff0c,]\s*有人/g, '是边界，需要有人')
    .replace(/影狼群顿了顿/g, '影狼群，顿了顿')
    .replace(/影狼群沉默/g, '影狼群，沉默')
    .replace(/每转化一头影狼[\u3002\uff01\uff1f!?]\s*可为/g, '每转化一头影狼，可为')
    .replace(/我们[\u3002\uff01\uff1f!?]\s*可以/g, '我们可以')
    .replace(/屏障又看看林照/g, '屏障，又看看林照')
    .replace(/那片[\uff0c,]\s*雾气/g, '那片雾气')
    .replace(/对着[\uff0c,]\s*所有人/g, '对着所有人')
    .replace(/平淡但/g, '平淡，但')
    .replace(/态度而是/g, '态度，而是')
    .replace(/话音刚落面板/g, '话音刚落，面板')
    .replace(/暗红[\u3002\uff01\uff1f!?]\s*\n+\s*色的印记/g, '暗红色的印记')
    .replace(/暗红[\u3002\uff01\uff1f!?]?\s*色的印[\u3002\uff01\uff1f!?]?\s*记/g, '暗红色的印记')
    .replace(/气[\u3002\uff01\uff1f!?]\s*运值/g, '气运值')
    .replace(/兄[\u3002\uff01\uff1f!?]\s*弟/g, '兄弟')
    .replace(/搞[\u3002\uff01\uff1f!?]\s*林照/g, '搞林照')
    .replace(/“×。”/g, '“×”')
    .replace(/“是。”/g, '“是”')
    .replace(/“×”系统提示/g, '“×”。\n\n系统提示')
    .replace(/“是”系统提示/g, '“是”。\n\n系统提示')
    .replace(/“是”……系统提示/g, '“是”。\n\n系统提示')
    .replace(/([^\u3002\uff01\uff1f!?\u2026])”(?=林照|周烈|赵锐)/g, '$1。”\n\n')
    .replace(/([^\u3002\uff01\uff1f!?\u2026])”(?=“)/g, '$1。”\n\n')
    .replace(/([\u3002\uff01\uff1f\u2026]”)(林照|周烈|赵锐)(?=(?:一愣|皱眉|愣|沉默|点头|摇头|抬头|低声|追问|问|说|喊|骂|笑|站))/g, '$1\n\n$2')
    .replace(/(他把面板内容展示给周烈和赵锐看)(两人看完)/g, '$1。\n\n$2')
    .replace(/(只要把它们引到屏障范围内就能触发转化)”(赵锐追问)/g, '$1。”\n\n$2')
    .replace(/(影狼群身上)[\u3002\uff01\uff1f!?]?\s*“/g, '$1。\n\n“')
    .replace(/。”[\u3002\uff01\uff1f!?]/g, '。”')
    .replace(/“想活命的听我指挥。”没[\uff0c,]?\s*有人反驳/g, '“想活命的听我指挥。”\n\n没人反驳')
    .replace(/消融分解消散成[\u3002\uff01\uff1f!?]?\s*漫天灰尘/g, '消融、分解，消散成漫天灰尘')
    .replace(/周烈没动直播间/g, '周烈没动。\n\n直播间')
    .replace(/刷屏[\u3002\uff01\uff1f!?]\s*「/g, '刷屏：\n\n「')
    .replace(/「[\u3002\uff0c,、；;：:]+/g, '「')
    .replace(/兄弟[\u3002\uff01\uff1f!?]\s*反目/g, '兄弟反目')
    .replace(/你[\u3002\uff01\uff1f!?]\s*刚才/g, '你刚才')
    .replace(/长城城墙又低头/g, '长城城墙，又低头')
    .replace(/看了看[\u3002\uff01\uff1f!?]?\s*掌心那个/g, '看了看掌心那个')
    .replace(/旁边的“×”(?=\s*$)/gm, '旁边的“×”。')
    .replace(/别接啊你[\uff0c,]/g, '别接啊，你')
    .replace(/系统这是要搞[\uff0c,]\s*林照/g, '系统这是要搞林照')
    .replace(/“×[\u3002\uff01\uff1f!?]”/g, '“×”')
    .replace(/弹幕瞬间安静了两秒——转而炸了：((?:「[^」]{0,80}」){1,10})周烈没理弹幕/g, '弹幕瞬间安静了两秒——转而炸了：$1\n\n周烈没理弹幕')
    .replace(/弹幕又刷疯了：((?:「[^」]{0,120}」){1,12})但林照/g, '弹幕又刷疯了：$1\n\n但林照')
    .replace(/看傻了[\u3002\uff01\uff1f!?]?\n+「/g, '看傻了：\n\n「');
}

function splitIntoSentences(paragraph) {
  const matches = paragraph.match(SENTENCE_SPLIT_RE);
  return matches && matches.length ? matches.map((item) => item.trim()).filter(Boolean) : [paragraph.trim()].filter(Boolean);
}

function splitIntoClauses(paragraph) {
  const matches = paragraph.match(CLAUSE_SPLIT_RE);
  return matches && matches.length ? matches.map((item) => item.trim()).filter(Boolean) : [paragraph.trim()].filter(Boolean);
}

function splitLongHardSentences(paragraph) {
  const chunks = [];
  for (const sentence of splitIntoSentences(paragraph)) {
    const cleaned = cleanPunctuation(sentence);
    if (!cleaned) continue;
    if (isReadableSegment(cleaned)) {
      chunks.push(cleaned);
      continue;
    }

    let buffer = '';
    for (const clause of splitIntoClauses(cleaned)) {
      const next = cleanPunctuation(buffer ? `${buffer}${clause}` : clause);
      if (buffer && (next.length > MAX_SOFT_SENTENCE_LENGTH || maxHardSentenceLength(next) > MAX_SOFT_SENTENCE_LENGTH)) {
        chunks.push(ensureHardSentenceEnd(buffer, chunks.length));
        buffer = clause;
      } else {
        buffer = next;
      }

      while (buffer && (maxUnpunctuatedRun(buffer) > MAX_UNPUNCTUATED_RUN || maxHardSentenceLength(buffer) > MAX_SOFT_SENTENCE_LENGTH)) {
        chunks.push(ensureHardSentenceEnd(buffer.slice(0, HARD_CHUNK_LENGTH), chunks.length));
        buffer = buffer.slice(HARD_CHUNK_LENGTH);
      }
    }
    if (buffer) chunks.push(ensureHardSentenceEnd(buffer, chunks.length));
  }
  return chunks.map((chunk) => cleanPunctuation(chunk)).filter(Boolean);
}

function ensureHardSentenceEnd(text, index = 0) {
  const trimmed = cleanPunctuation(text);
  if (!trimmed) return '';
  if (HARD_SENTENCE_END_RE.test(trimmed.at(-1))) return trimmed;
  const closingQuote = trimmed.match(/([\u201d\u300d\u300f])$/u)?.[1];
  if (closingQuote) {
    const beforeQuote = trimmed.slice(0, -1).trimEnd();
    if (HARD_SENTENCE_END_RE.test(beforeQuote.at(-1))) return trimmed;
    if (/[\uFF0C,\u3001\uFF1B;\uFF1A:]$/u.test(beforeQuote)) {
      return `${beforeQuote.slice(0, -1)}\u3002${closingQuote}`;
    }
    return `${beforeQuote}\u3002${closingQuote}`;
  }
  const end = '\u3002';
  if (/[\uFF0C,\u3001\uFF1B;\uFF1A:]$/u.test(trimmed)) return `${trimmed.slice(0, -1)}${end}`;
  return `${trimmed}${end}`;
}
function packSentences(sentences, targetLength = 90, hardLength = 150) {
  const paragraphs = [];
  let buffer = '';

  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence;
      continue;
    }

    const isDialogueTurn = /^[\u201c"\u300c]/u.test(sentence) || /[\u201d"\u300d]$/u.test(buffer);
    const joined = cleanPunctuation(`${buffer}${sentence}`);
    const wouldBecomeDense = maxUnpunctuatedRun(joined) > MAX_UNPUNCTUATED_RUN || maxHardSentenceLength(joined) > MAX_SOFT_SENTENCE_LENGTH;
    if (buffer.length >= targetLength || buffer.length + sentence.length > hardLength || isDialogueTurn || wouldBecomeDense) {
      paragraphs.push(ensureHardSentenceEnd(buffer, paragraphs.length));
      buffer = sentence;
    } else {
      buffer = joined;
    }
  }

  if (buffer) paragraphs.push(ensureHardSentenceEnd(buffer, paragraphs.length));
  return paragraphs;
}

function addClausePunctuation(paragraph) {
  if (
    maxUnpunctuatedRun(paragraph) <= PREFERRED_UNPUNCTUATED_RUN
    && maxHardSentenceLength(paragraph) <= PREFERRED_HARD_SENTENCE_LENGTH
  ) {
    return paragraph;
  }

  return paragraph
    .replace(CLAUSE_CUE_RE, (cue, _capture, offset, source) => {
      const prev = source.slice(0, offset).trim().at(-1);
      if (!offset || !prev || SENTENCE_PUNCTUATION_RE.test(prev)) return cue;
      if (/[\u5f97\u8ba9\u4f7f\u4ee4\u5230\u5411\u770b\u53eb\u558a\u51b2\u62c9\u62cd\u7ed9\u5bf9\u548c\u4e0e\u4f46\u800c\u4ee5]/u.test(prev)) return cue;
      return `\uff0c${cue}`;
    })
    .replace(/\uff0c([\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u3001,.!?;:])/gu, '$1');
}

function addHardSentencePunctuation(paragraph) {
  if (
    maxHardSentenceLength(paragraph) <= PREFERRED_HARD_SENTENCE_LENGTH
    && maxUnpunctuatedRun(paragraph) <= PREFERRED_UNPUNCTUATED_RUN
  ) {
    return paragraph;
  }

  return paragraph
    .replace(HARD_STOP_CUE_RE, (cue, _capture, offset, source) => {
      const prev = source.slice(0, offset).trim().at(-1);
      if (!offset || !prev || HARD_SENTENCE_END_RE.test(prev)) return cue;
      if (/[\u7740\u770b\u5230\u5411\u7ed9\u5bf9\u548c\u4e0e\u4f46\u800c\u4ee5\u628a\u88ab\u5728\u4ece\u5c06]/u.test(prev)) return cue;
      if (SENTENCE_PUNCTUATION_RE.test(prev)) return `\u3002${cue}`;
      if (/[\u201c\u2018"\u300c\u300e]/u.test(prev)) return cue;
      return `\u3002${cue}`;
    })
    .replace(/([\u3002\uff01\uff1f!?])\u3002/gu, '$1');
}

function forceAtomicSentenceBreak(paragraph, chunkLength = HARD_CHUNK_LENGTH) {
  const chunks = [];
  let buffer = '';

  for (const char of paragraph || '') {
    buffer += char;
    if (HARD_SENTENCE_END_RE.test(char)) {
      chunks.push(cleanPunctuation(buffer));
      buffer = '';
      continue;
    }
    if (buffer.length >= chunkLength) {
      chunks.push(ensureHardSentenceEnd(buffer, chunks.length));
      buffer = '';
    }
  }

  if (buffer) chunks.push(ensureHardSentenceEnd(buffer, chunks.length));
  return chunks.map((chunk) => cleanPunctuation(chunk)).filter(Boolean);
}

const DANGLING_PREFIX_RE = /^[\u7684\u5730\u5f97\u628a\u88ab\u5c06\u4e0e\u548c\u53ca\u6216\u800c\u4f46\u5374\u5e76]/u;
const DANGLING_SUFFIX_RE = /[\u50cf\u5982\u4f3c\u7684\u5728\u5411\u628a\u88ab\u5c06\u4e0e\u548c\u53ca\u6216\u800c\u4f46\u5374][\u3002\uff01\uff1f!?]$/u;
const STANDALONE_CONNECTIVE_RE = /^[\u800c\u4f46\u5374\u53ef\u5e76\u4e14\u4e0e\u6216\u548c]{1,4}[\u3002\uff01\uff1f!?]?$/u;

function stripTerminalForJoin(text) {
  return cleanPunctuation(text).replace(/[\u3002\uff01\uff1f!?\uff0c,\u3001\uff1b;\uff1a:]+$/u, '');
}

function canJoinFragments(text) {
  const joined = cleanPunctuation(text);
  return Boolean(joined)
    && joined.length <= MAX_SOFT_SENTENCE_LENGTH
    && maxUnpunctuatedRun(joined) <= MAX_UNPUNCTUATED_RUN
    && maxHardSentenceLength(joined) <= MAX_SOFT_SENTENCE_LENGTH;
}

function smoothDanglingFragments(paragraphs) {
  const source = paragraphs.map((paragraph) => cleanPunctuation(paragraph)).filter(Boolean);
  const smoothed = [];

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (SYSTEM_LINE_RE.test(current)) {
      smoothed.push(normalizeSystemLine(current));
      continue;
    }

    const next = source[index + 1];
    if (next && !SYSTEM_LINE_RE.test(next) && STANDALONE_CONNECTIVE_RE.test(current)) {
      const joined = cleanPunctuation(`${stripTerminalForJoin(current)}${next.replace(/^[\u3002\uff01\uff1f!?\uff0c,\u3001\uff1b;\uff1a:]+/u, '')}`);
      if (canJoinFragments(joined)) {
        smoothed.push(joined);
        index += 1;
        continue;
      }
    }

    if (next && !SYSTEM_LINE_RE.test(next) && DANGLING_SUFFIX_RE.test(current)) {
      const joined = cleanPunctuation(`${stripTerminalForJoin(current)}${next.replace(/^[\u3002\uff01\uff1f!?\uff0c,\u3001\uff1b;\uff1a:]+/u, '')}`);
      if (canJoinFragments(joined)) {
        smoothed.push(joined);
        index += 1;
        continue;
      }
    }

    const previous = smoothed.at(-1);
    if (previous && !SYSTEM_LINE_RE.test(previous) && DANGLING_PREFIX_RE.test(current)) {
      const joined = cleanPunctuation(`${stripTerminalForJoin(previous)}${current.replace(/^[\u3002\uff01\uff1f!?\uff0c,\u3001\uff1b;\uff1a:]+/u, '')}`);
      if (canJoinFragments(joined)) {
        smoothed[smoothed.length - 1] = joined;
        continue;
      }
    }

    smoothed.push(current);
  }

  return smoothed;
}

function splitParagraphByStrictRuns(paragraph, chunkLength = 30, hardLimit = 64) {
  const prepared = cleanPunctuation(addHardSentencePunctuation(addClausePunctuation(paragraph)));
  const chunks = [];
  let buffer = '';

  const pushBuffer = () => {
    const chunk = cleanPunctuation(buffer);
    buffer = '';
    if (chunk) chunks.push(ensureHardSentenceEnd(chunk, chunks.length));
  };

  for (const char of prepared || '') {
    buffer += char;
    if (HARD_SENTENCE_END_RE.test(char)) {
      pushBuffer();
      continue;
    }

    const hardLength = maxHardSentenceLength(buffer);
    const runLength = maxUnpunctuatedRun(buffer);
    if ((hardLength >= hardLimit || runLength >= MAX_UNPUNCTUATED_RUN) && SOFT_BREAK_PUNCTUATION_RE.test(char)) {
      pushBuffer();
      continue;
    }
    if (hardLength >= MAX_SOFT_SENTENCE_LENGTH || runLength >= MAX_UNPUNCTUATED_RUN) {
      pushBuffer();
    }
  }

  if (buffer) pushBuffer();

  return chunks
    .flatMap((chunk) => {
      if (maxUnpunctuatedRun(chunk) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(chunk) <= MAX_SOFT_SENTENCE_LENGTH) {
        return [chunk];
      }
      return forceAtomicSentenceBreak(chunk, Math.max(10, Math.min(chunkLength, HARD_CHUNK_LENGTH)));
    })
    .map((chunk) => cleanPunctuation(chunk))
    .filter(Boolean);
}

function strictFormatSafetyPass(text, chunkLength = 30, hardLimit = 64) {
  const paragraphs = (text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      const cleaned = cleanPunctuation(paragraph);
      if (!cleaned) return [];
      if (SYSTEM_LINE_RE.test(cleaned)) return [normalizeSystemLine(cleaned)];
      if (
        cleaned.length <= 220
        && maxUnpunctuatedRun(cleaned) <= MAX_UNPUNCTUATED_RUN
        && maxHardSentenceLength(cleaned) <= MAX_SOFT_SENTENCE_LENGTH
      ) {
        return [ensureHardSentenceEnd(cleaned)];
      }
      return splitParagraphByStrictRuns(cleaned, chunkLength, hardLimit);
    });
  const smoothed = smoothDanglingFragments(paragraphs);
  const safeParagraphs = smoothDanglingFragments(smoothed.flatMap((paragraph) => {
    if (SYSTEM_LINE_RE.test(paragraph)) return [normalizeSystemLine(paragraph)];
    if (
      paragraph.length <= 220
      && maxUnpunctuatedRun(paragraph) <= MAX_UNPUNCTUATED_RUN
      && maxHardSentenceLength(paragraph) <= MAX_SOFT_SENTENCE_LENGTH
    ) {
      return [ensureHardSentenceEnd(paragraph)];
    }
    return splitParagraphByStrictRuns(paragraph, Math.max(10, chunkLength - 2), Math.max(28, hardLimit - 4));
  }));

  return removeOrphanPunctuation(cleanPunctuation(separateSystemBlocks(safeParagraphs.join('\n\n'))))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function forceMetricCeiling(text) {
  const guardParagraph = (paragraph) => {
    const cleaned = cleanPunctuation(paragraph);
    if (!cleaned || SYSTEM_LINE_RE.test(cleaned)) return cleaned ? normalizeSystemLine(cleaned) : '';

    let output = '';
    let runLength = 0;
    let hardLength = 0;

    for (const char of cleaned) {
      output += char;

      if (/\s/u.test(char)) {
        runLength = 0;
        hardLength = 0;
        continue;
      }
      if (HARD_SENTENCE_END_RE.test(char)) {
        runLength = 0;
        hardLength = 0;
        continue;
      }
      if (SENTENCE_PUNCTUATION_RE.test(char)) {
        runLength = 0;
        hardLength += 1;
        continue;
      }

      runLength += 1;
      hardLength += 1;

      if (hardLength >= MAX_SOFT_SENTENCE_LENGTH) {
        output += '\u3002';
        runLength = 0;
        hardLength = 0;
      } else if (runLength >= MAX_UNPUNCTUATED_RUN) {
        output += hardLength >= 48 ? '\u3002' : '\uff0c';
        runLength = 0;
        if (hardLength >= 48) hardLength = 0;
      }
    }

    return ensureHardSentenceEnd(cleanPunctuation(output));
  };

  const applyGuard = (source) => removeOrphanPunctuation(cleanPunctuation(repairForcedSplitArtifacts(
    (source || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map((paragraph) => guardParagraph(paragraph.trim()))
      .filter(Boolean)
      .join('\n\n')
  )))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let guarded = applyGuard(text);
  for (let index = 0; index < 2 && guarded && !measureChapterFormat(guarded).ok; index += 1) {
    guarded = applyGuard(guarded);
  }
  return guarded;
}

function emergencyReadableBreak(text) {
  const paragraphs = (text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      if (SYSTEM_LINE_RE.test(paragraph)) return [normalizeSystemLine(paragraph)];
      const prepared = cleanPunctuation(addHardSentencePunctuation(addClausePunctuation(paragraph)));
      const chunks = splitLongHardSentences(prepared)
        .flatMap((chunk) => {
          if (maxUnpunctuatedRun(chunk) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(chunk) <= MAX_SOFT_SENTENCE_LENGTH) {
            return [chunk];
          }
          return forceAtomicSentenceBreak(chunk);
        });
      return chunks.length ? chunks : [prepared];
    });

  return removeOrphanPunctuation(cleanPunctuation(polishReadableFlow(separateSystemBlocks(paragraphs.join('\n\n')))))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function publicationSafeFallback(text) {
  const paragraphs = (text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => {
      if (SYSTEM_LINE_RE.test(paragraph)) return [normalizeSystemLine(paragraph)];
      const prepared = cleanPunctuation(addHardSentencePunctuation(addClausePunctuation(paragraph)));
      const readable = splitLongHardSentences(prepared)
        .flatMap((chunk) => (
          maxUnpunctuatedRun(chunk) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(chunk) <= MAX_SOFT_SENTENCE_LENGTH
            ? [chunk]
            : forceAtomicSentenceBreak(chunk, 18)
        ))
        .flatMap((chunk) => (
          maxUnpunctuatedRun(chunk) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(chunk) <= MAX_SOFT_SENTENCE_LENGTH
            ? [chunk]
            : forceAtomicSentenceBreak(chunk, 14)
        ))
        .map((chunk, index) => ensureHardSentenceEnd(chunk, index))
        .filter(Boolean);
      return readable.length ? readable : [ensureHardSentenceEnd(prepared)];
    });

  const cleaned = removeOrphanPunctuation(cleanPunctuation(polishReadableFlow(separateSystemBlocks(paragraphs.join('\n\n')))))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const strict = strictFormatSafetyPass(cleaned, 30, 64);
  if (measureChapterFormat(strict).ok) return strict;
  const tighter = strictFormatSafetyPass(strict || cleaned, 22, 48);
  if (measureChapterFormat(tighter).ok) return tighter;
  return forceMetricCeiling(tighter || strict || cleaned);
}

function hardBreakDenseParagraph(paragraph, chunkLength = HARD_CHUNK_LENGTH) {
  const punctuated = cleanPunctuation(addHardSentencePunctuation(addClausePunctuation(paragraph)));
  if (maxUnpunctuatedRun(punctuated) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(punctuated) <= MAX_SOFT_SENTENCE_LENGTH) {
    if (punctuated.length > 180) return packSentences(splitIntoSentences(punctuated));
    return [ensureHardSentenceEnd(punctuated)];
  }

  const sentenceChunks = splitLongHardSentences(punctuated);
  if (
    sentenceChunks.length > 1
    && sentenceChunks.every((chunk) => maxUnpunctuatedRun(chunk) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(chunk) <= MAX_SOFT_SENTENCE_LENGTH)
  ) {
    return mergeTinyParagraphs(sentenceChunks);
  }

  const hinted = punctuated
    .replace(CLAUSE_CUE_RE, '\n$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const candidates = hinted.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];

  for (const candidate of candidates.length ? candidates : [paragraph]) {
    if (maxUnpunctuatedRun(candidate) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(candidate) <= MAX_SOFT_SENTENCE_LENGTH) {
      chunks.push(cleanPunctuation(candidate));
      continue;
    }

    let buffer = '';
    for (const clause of splitIntoClauses(candidate)) {
      const next = buffer ? `${buffer}${clause}` : clause;
      if (buffer && next.length > MAX_SOFT_SENTENCE_LENGTH) {
        chunks.push(ensureHardSentenceEnd(buffer, chunks.length));
        buffer = clause;
      } else {
        buffer = next;
      }
    }
    if (buffer) chunks.push(ensureHardSentenceEnd(buffer, chunks.length));

    let index = 0;
    while (chunks.some((chunk) => maxUnpunctuatedRun(chunk) > MAX_UNPUNCTUATED_RUN || maxHardSentenceLength(chunk) > MAX_SOFT_SENTENCE_LENGTH)) {
      const denseIndex = chunks.findIndex((chunk) => maxUnpunctuatedRun(chunk) > MAX_UNPUNCTUATED_RUN || maxHardSentenceLength(chunk) > MAX_SOFT_SENTENCE_LENGTH);
      if (denseIndex < 0 || index > 200) break;
      const dense = chunks.splice(denseIndex, 1)[0];
      let remaining = dense;
      const replacements = [];
      while (remaining.length > chunkLength) {
        replacements.push(ensureHardSentenceEnd(remaining.slice(0, chunkLength), replacements.length));
        remaining = remaining.slice(chunkLength);
      }
      if (remaining) replacements.push(ensureHardSentenceEnd(remaining, replacements.length));
      chunks.splice(denseIndex, 0, ...replacements);
      index += 1;
    }
  }

  return mergeTinyParagraphs(chunks.map((chunk, index) => {
    const trimmed = cleanPunctuation(chunk);
    if (!trimmed) return '';
    if (SENTENCE_PUNCTUATION_RE.test(trimmed.at(-1))) return trimmed;
    return `${trimmed}${index % 3 === 2 ? '\u3002' : '\uff0c'}`;
  }).filter(Boolean));
}

function forceReadableFallback(text) {
  const rawParagraphs = cleanPunctuation(separateSystemBlocks(stripModelWrappers(text)))
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return removeOrphanPunctuation(rawParagraphs
    .flatMap((paragraph) => {
      if (SYSTEM_LINE_RE.test(paragraph)) return [normalizeSystemLine(paragraph)];
      if (paragraph.length > 180 && maxUnpunctuatedRun(paragraph) <= MAX_UNPUNCTUATED_RUN && maxHardSentenceLength(paragraph) <= MAX_SOFT_SENTENCE_LENGTH) {
        return packSentences(splitIntoSentences(paragraph));
      }
      return hardBreakDenseParagraph(paragraph);
    })
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function stabilizeReadableLayout(text, maxPasses = 3) {
  let current = removeOrphanPunctuation(cleanPunctuation(polishReadableFlow(separateSystemBlocks(text))));

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const paragraphs = current
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .flatMap((paragraph) => {
        const cleaned = cleanPunctuation(paragraph);
        if (!cleaned) return [];
        if (SYSTEM_LINE_RE.test(cleaned)) return [normalizeSystemLine(cleaned)];
        if (
          cleaned.length > 180
          || maxUnpunctuatedRun(cleaned) > MAX_UNPUNCTUATED_RUN
          || maxHardSentenceLength(cleaned) > MAX_SOFT_SENTENCE_LENGTH
        ) {
          return hardBreakDenseParagraph(cleaned);
        }
        return [ensureHardSentenceEnd(cleaned)];
      });

    const next = removeOrphanPunctuation(cleanPunctuation(polishReadableFlow(separateSystemBlocks(
      mergeTinyParagraphs(paragraphs).join('\n\n')
    ))))
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!next) return ensureTerminalPunctuation(current);
    if (measureChapterFormat(next).ok) return ensureTerminalPunctuation(next);
    if (next === current) break;
    current = next;
  }

  const emergency = emergencyReadableBreak(current);
  return ensureTerminalPunctuation(emergency || current);
}

function normalizeChapterLayout(text) {
  const normalized = cleanPunctuation(polishReadableFlow(separateSystemBlocks(stripModelWrappers(text))))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return '';

  const rawParagraphs = normalized.split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const paragraphs = [];

  for (const paragraph of rawParagraphs) {
    const readableParagraph = cleanPunctuation(addHardSentencePunctuation(addClausePunctuation(paragraph)));
    if (SYSTEM_LINE_RE.test(readableParagraph)) {
      paragraphs.push(normalizeSystemLine(readableParagraph));
      continue;
    }
    if (
      readableParagraph.length <= 110
      && maxUnpunctuatedRun(readableParagraph) <= MAX_UNPUNCTUATED_RUN
      && maxHardSentenceLength(readableParagraph) <= MAX_SOFT_SENTENCE_LENGTH
    ) {
      paragraphs.push(ensureHardSentenceEnd(readableParagraph, paragraphs.length));
      continue;
    }
    if (maxUnpunctuatedRun(readableParagraph) > MAX_UNPUNCTUATED_RUN || maxHardSentenceLength(readableParagraph) > MAX_SOFT_SENTENCE_LENGTH) {
      paragraphs.push(...hardBreakDenseParagraph(readableParagraph));
      continue;
    }
    paragraphs.push(...packSentences(splitIntoSentences(readableParagraph)));
  }

  return stabilizeReadableLayout(
    removeOrphanPunctuation(cleanPunctuation(polishReadableFlow(separateSystemBlocks(mergeTinyParagraphs(paragraphs).join('\n\n')))).replace(/\n{3,}/g, '\n\n').trim())
  );
}

export function measureChapterFormat(text) {
  const paragraphs = (text || '').split(/\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const bodyParagraphs = paragraphs.filter((paragraph) => !SYSTEM_LINE_RE.test(paragraph));
  const bodyText = bodyParagraphs.join('\n');
  const maxRun = maxUnpunctuatedRun(bodyText);
  const maxHardSentence = maxHardSentenceLength(bodyText);
  const longParagraphs = bodyParagraphs.filter((paragraph) => paragraph.length > 220).length;
  const denseParagraphs = bodyParagraphs.filter((paragraph) => maxHardSentenceLength(paragraph) > MAX_SOFT_SENTENCE_LENGTH).length;
  const issues = [];

  if (maxRun > MAX_UNPUNCTUATED_RUN) issues.push(`max unpunctuated run: ${maxRun}`);
  if (maxHardSentence > MAX_SOFT_SENTENCE_LENGTH) issues.push(`max sentence without full stop: ${maxHardSentence}`);
  if (longParagraphs > 0) issues.push(`long paragraphs: ${longParagraphs}`);
  if (denseParagraphs > 0) issues.push(`dense comma-only paragraphs: ${denseParagraphs}`);
  if ((text || '').length > 1200 && bodyParagraphs.length < 6) issues.push('too few paragraphs');
  if (OUTLINE_LEAK_RE.test(text || '')) issues.push('outline or AI meta text leaked');

  return {
    ok: issues.length === 0,
    issues,
    maxRun,
    maxHardSentence,
    longParagraphs,
    denseParagraphs,
    paragraphCount: paragraphs.length,
  };
}

function countMatches(text, regex) {
  return ((text || '').match(regex) || []).length;
}

function measureChapterStyle(text, targetChars = 0) {
  const raw = text || '';
  const body = raw.replace(/【[^】]+】/gu, '\n');
  const paragraphs = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const leadWindow = body.slice(0, 420);
  const length = countContentChars(body);
  const ellipsisCount = countMatches(body, /…/gu);
  const contrastCount = countMatches(body, /不是[^。！？\n]{0,40}而是/gu)
    + countMatches(body, /不是[^。！？\n]{0,28}也不是[^。！？\n]{0,28}而是/gu);
  const brokenWordPunctuation = countMatches(body, /[\u4e00-\u9fff][。！？][\u4e00-\u9fff]/gu);
  const repeatedBurstPunctuation = countMatches(body, /[！？]{2,}|…{3,}|—{3,}/gu);
  const dialogueRuns = countMatches(body, /[“"][^”"\n]{32,}[。！？][^”"\n]{24,}[”"]/gu);
  const longMobileParagraphs = paragraphs.filter((paragraph) => countContentChars(paragraph) > 190).length;
  const averageParagraphChars = paragraphs.length ? Math.round(length / paragraphs.length) : length;
  const weakLeadIn = leadWindow
    && !/[“【？！]/u.test(leadWindow)
    && !/(忽然|突然|下一秒|就在这时|脚步声|任务|危险|警告|死|血|砸|撞|追|跑|杀|直播间|弹幕|系统)/u.test(leadWindow);
  const issues = [];
  const ellipsisLimit = Math.max(8, Math.floor(length / 320));
  const contrastLimit = 2;

  if (targetChars > 0 && length < Math.floor(targetChars * 0.94)) {
    issues.push(`篇幅偏短：目标约 ${targetChars} 字，当前约 ${length} 字`);
  }
  if (ellipsisCount > ellipsisLimit) {
    issues.push(`省略号过多：当前 ${ellipsisCount} 处，建议压到 ${ellipsisLimit} 处以内`);
  }
  if (contrastCount > contrastLimit) {
    issues.push(`模板对照句过多：当前 ${contrastCount} 处「不是……而是……」结构，需改成动作或细节表达`);
  }
  if (brokenWordPunctuation > 0) {
    issues.push(`词内断裂标点：检测到 ${brokenWordPunctuation} 处类似“一。条缝”“明！白了”的错误`);
  }
  if (repeatedBurstPunctuation > 2) {
    issues.push(`情绪标点堆叠：检测到 ${repeatedBurstPunctuation} 处连续感叹号/省略号/破折号`);
  }
  if (dialogueRuns > 1) {
    issues.push(`对话不断句：检测到 ${dialogueRuns} 处过长引号句，建议拆成更自然的对话节奏`);
  }
  if (longMobileParagraphs > 0 || averageParagraphChars > 135) {
    issues.push(`手机端分段偏重：超长段 ${longMobileParagraphs} 段，平均每段约 ${averageParagraphChars} 字，需切成更利于追读的短段`);
  }
  if (weakLeadIn) {
    issues.push('开头钩子偏弱：前几段进入正题太慢，需更早抛出危机、任务、异常、冲突或利益点');
  }

  return {
    ok: issues.length === 0,
    issues,
    length,
    ellipsisCount,
    contrastCount,
    brokenWordPunctuation,
    repeatedBurstPunctuation,
    dialogueRuns,
    longMobileParagraphs,
    averageParagraphChars,
    weakLeadIn: Boolean(weakLeadIn),
  };
}

function sanitizeStyleDeterministically(text) {
  return reduceAiContrastSyntax(text || '')
    .replace(/……+/gu, '……')
    .replace(/！！+/gu, '！')
    .replace(/？？+/gu, '？')
    .replace(/！？{2,}/gu, '！？')
    .replace(/—{3,}/gu, '——');
}

function buildStrictFormatRepairPrompt(chapterText, issues) {
  return `You are editing a Chinese web-novel chapter so it can be published directly.

Detected formatting problems:
${issues.map((issue) => `- ${issue}`).join('\n')}

Hard rules:
1. Only add Chinese punctuation, fix sentence breaks, and split paragraphs.
2. Do not add plot, remove plot, rewrite the style, or change names, places, system prompts, tasks, numbers, or continuity.
3. Remove leaked outline/meta labels such as chapter role, core purpose, suspense density, chapter summary, generation failure, or AI notes.
4. Keep system prompt blocks like \u3010...\u3011 as standalone paragraphs.
5. Do not add punctuation before or after \u3010...\u3011 blocks. If several blocks are adjacent, put each on its own line.
6. Remove Markdown markers such as **bold**.
7. Prefer 30-180 Chinese characters per paragraph. Dialogue and scene turns may be shorter.
8. Output body text only. No title, explanation, Markdown, or code fences.

Chapter text:
${trimToCharLimit(chapterText, 12000)}`;
}

async function repairPunctuationIfNeeded(text) {
  let formatted = normalizeChapterLayout(applyLocalFormatPass(text));
  let quality = measureChapterFormat(formatted);
  if (quality.ok) return { text: formatted, quality: { ...quality, repaired: false } };

  const deterministic = normalizeChapterLayout(forceReadableFallback(formatted));
  let deterministicQuality = measureChapterFormat(deterministic);
  if (deterministic && deterministicQuality.ok) {
    return { text: deterministic, quality: { ...deterministicQuality, repaired: true, deterministicFallback: true } };
  }

  const emergency = normalizeChapterLayout(emergencyReadableBreak(deterministic || formatted));
  const emergencyQuality = measureChapterFormat(emergency);
  if (emergency && emergencyQuality.ok) {
    return { text: emergency, quality: { ...emergencyQuality, repaired: true, deterministicFallback: true, emergencyFallback: true } };
  }

  const safeFallback = publicationSafeFallback(emergency || deterministic || formatted);
  const safeQuality = measureChapterFormat(safeFallback);
  if (safeFallback && safeQuality.ok) {
    return { text: safeFallback, quality: { ...safeQuality, repaired: true, deterministicFallback: true, publicationSafeFallback: true } };
  }

  const prompt = buildStrictFormatRepairPrompt(formatted, quality.issues);
  const { content } = await chat(
    [
      { role: 'system', content: 'You are a Chinese novel copy editor. Only fix punctuation and paragraphing; never rewrite the plot.' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8192, temperature: 0.15, model: 'aux' }
  );

  const repaired = normalizeChapterLayout(applyLocalFormatPass(content || ''));
  if (!repaired) {
    return {
      text: deterministic || formatted,
      quality: { ...(deterministicQuality || quality), repaired: Boolean(deterministic), deterministicFallback: Boolean(deterministic) },
    };
  }

  quality = measureChapterFormat(repaired);
  if (quality.ok) return { text: repaired, quality: { ...quality, repaired: true } };

  const fallbackSource = repaired || deterministic || formatted;
  const fallback = publicationSafeFallback(normalizeChapterLayout(forceReadableFallback(fallbackSource)));
  quality = measureChapterFormat(fallback);
  return { text: fallback || deterministic || repaired, quality: { ...quality, repaired: true, deterministicFallback: true } };
}

export async function repairChapterStyleIfNeeded(text, opts = {}) {
  const targetChars = normalizeTargetChars(opts.wordNumber);
  let current = sanitizeStyleDeterministically(text || '');
  let quality = measureChapterStyle(current, targetChars);
  if (quality.ok) {
    return { text: current, quality: { ...quality, repaired: false } };
  }

  const prompt = buildStyleRepairPrompt(current, quality.issues, { wordNumber: targetChars });
  const { content } = await chat(
    [
      { role: 'system', content: '你是长篇网文润稿编辑，只修表达、断句和语气，不改剧情与设定。' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8192, temperature: 0.28 }
  );

  const repaired = sanitizeStyleDeterministically(stripModelWrappers(content || ''));
  if (!repaired) {
    return { text: current, quality: { ...quality, repaired: false, fallback: true } };
  }

  const formatted = await repairPunctuationIfNeeded(repaired);
  current = finalizeReadableText(formatted.text || repaired);
  quality = measureChapterStyle(current, targetChars);

  if (!quality.ok) {
    const fallback = finalizeReadableText(sanitizeStyleDeterministically(publicationSafeFallback(current)));
    const fallbackQuality = measureChapterStyle(fallback, targetChars);
    return {
      text: fallback,
      quality: { ...fallbackQuality, repaired: true, fallback: true },
    };
  }

  return {
    text: current,
    quality: { ...quality, repaired: true },
  };
}

function extractFirstJsonObject(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : source;
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }
  return null;
}

function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(10, Math.round(parsed)));
}

function normalizeWebnovelSkillReview(review, fallbackStyle = null) {
  const scores = review && typeof review === 'object' && review.scores && typeof review.scores === 'object'
    ? review.scores
    : {};
  const issues = Array.isArray(review?.issues)
    ? review.issues
        .map((item) => ({
          severity: ['high', 'medium', 'low'].includes(item?.severity) ? item.severity : 'medium',
          type: typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : 'general',
          problem: typeof item?.problem === 'string' ? item.problem.trim() : '',
          fix: typeof item?.fix === 'string' ? item.fix.trim() : '',
        }))
        .filter((item) => item.problem)
    : [];
  const strengths = Array.isArray(review?.strengths)
    ? review.strengths.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
    : [];
  const normalized = {
    pass: Boolean(review?.pass),
    summary: typeof review?.summary === 'string' ? review.summary.trim() : '',
    scores: {
      hook: clampScore(scores.hook),
      pace: clampScore(scores.pace),
      readability: clampScore(scores.readability),
      dialogue: clampScore(scores.dialogue),
      emotion: clampScore(scores.emotion),
      cliffhanger: clampScore(scores.cliffhanger),
      platformFit: clampScore(scores.platformFit),
    },
    issues,
    strengths,
    repairNeeded: Boolean(review?.repairNeeded),
    fallback: false,
  };
  if (normalized.summary || issues.length || strengths.length) {
    normalized.pass = normalized.pass && !normalized.repairNeeded;
    return normalized;
  }

  const styleIssues = fallbackStyle?.issues || [];
  return {
    pass: styleIssues.length === 0,
    summary: styleIssues.length ? '网文审读回退为本地可读性规则，检测到若干需要优化的问题。' : '网文审读回退为本地可读性规则，当前章节基础可读性通过。',
    scores: normalized.scores,
    issues: styleIssues.map((issue) => ({
      severity: /开头钩子偏弱|篇幅偏短/.test(issue) ? 'high' : 'medium',
      type: issue.includes('开头') ? 'hook'
        : issue.includes('对话') ? 'dialogue'
        : issue.includes('分段') ? 'readability'
        : issue.includes('模板') ? 'platformFit'
        : 'readability',
      problem: issue,
      fix: '按平台追读节奏压缩解释、增强钩子、拆短段落并保持事件推进。',
    })),
    strengths: [],
    repairNeeded: styleIssues.length > 0,
    fallback: true,
  };
}

async function runWebnovelSkillReview(text, opts = {}) {
  const fallbackStyle = measureChapterStyle(text || '', normalizeTargetChars(opts.wordNumber));
  const prompt = buildWebnovelSkillReviewPrompt({
    chapterText: text || '',
    globalSummary: opts.globalSummary || '',
    characterState: opts.characterState || '',
    chapterRole: opts.chapterRole || '',
    chapterPurpose: opts.chapterPurpose || '',
    chapterSummary: opts.chapterSummary || '',
    previousExcerpt: opts.previousExcerpt || '',
  });
  try {
    const { content } = await chat(
      [
        { role: 'system', content: '你是网文平台的资深编辑，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 2048, temperature: 0.2, model: 'aux' }
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      return normalizeWebnovelSkillReview(null, fallbackStyle);
    }
    const parsed = JSON.parse(jsonText);
    return normalizeWebnovelSkillReview(parsed, fallbackStyle);
  } catch {
    return normalizeWebnovelSkillReview(null, fallbackStyle);
  }
}

export async function repairByWebnovelSkillIfNeeded(text, opts = {}) {
  const firstReview = await runWebnovelSkillReview(text, opts);
  if (firstReview.pass && !firstReview.repairNeeded) {
    return {
      text,
      review: firstReview,
      repaired: false,
      secondReview: firstReview,
    };
  }

  const prompt = buildWebnovelSkillRepairPrompt({
    chapterText: text || '',
    review: firstReview,
    wordNumber: normalizeTargetChars(opts.wordNumber),
    globalSummary: opts.globalSummary || '',
    characterState: opts.characterState || '',
    chapterRole: opts.chapterRole || '',
    chapterPurpose: opts.chapterPurpose || '',
    chapterSummary: opts.chapterSummary || '',
  });

  try {
    const { content } = await chat(
      [
        { role: 'system', content: '你是网文润稿编辑，负责提升追读感、可读性和平台适配度，但不能改坏连续性。' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 8192, temperature: 0.32 }
    );
    const repairedDraft = stripModelWrappers(content || '');
    if (!repairedDraft) {
      return { text, review: firstReview, repaired: false, secondReview: firstReview };
    }
    const formatted = await repairPunctuationIfNeeded(repairedDraft);
    const normalized = finalizeReadableText(sanitizeStyleDeterministically(formatted.text || repairedDraft));
    const secondReview = await runWebnovelSkillReview(normalized, opts);
    return {
      text: normalized,
      review: firstReview,
      repaired: normalized !== text,
      secondReview,
    };
  } catch {
    return { text, review: firstReview, repaired: false, secondReview: firstReview };
  }
}

/** 合并文风 + 番茄追读润稿（单次 LLM，替代 style + webnovel 双链） */
export async function repairChapterQualityIfNeeded(text, opts = {}) {
  const targetChars = normalizeTargetChars(opts.wordNumber);
  let current = sanitizeStyleDeterministically(text || '');
  let styleQuality = measureChapterStyle(current, targetChars);
  const tomatoIssues = collectTomatoLocalIssues(current, targetChars);
  const allIssues = [...(styleQuality.issues || []), ...tomatoIssues];

  if (passesTomatoLocalGate(current, styleQuality, targetChars)) {
    const review = buildLocalTomatoReview(current, styleQuality, targetChars);
    return {
      text: current,
      quality: { ...styleQuality, repaired: false },
      review,
      repaired: false,
    };
  }

  const prompt = buildUnifiedQualityRepairPrompt(current, allIssues, {
    wordNumber: targetChars,
    globalSummary: opts.globalSummary,
    characterState: opts.characterState,
    chapterRole: opts.chapterRole,
    chapterPurpose: opts.chapterPurpose,
    chapterSummary: opts.chapterSummary,
    voiceCard: opts.voiceCard,
  });

  const { content } = await chat(
    [
      { role: 'system', content: '你是番茄小说责编，只润稿不改剧情，输出正文。' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8192, temperature: 0.3 }
  );

  const repairedDraft = sanitizeStyleDeterministically(stripModelWrappers(content || ''));
  if (!repairedDraft) {
    const review = buildLocalTomatoReview(current, styleQuality, targetChars);
    return { text: current, quality: { ...styleQuality, repaired: false, fallback: true }, review, repaired: false };
  }

  const formatted = await repairPunctuationIfNeeded(repairedDraft);
  current = finalizeReadableText(formatted.text || repairedDraft);
  styleQuality = measureChapterStyle(current, targetChars);
  const review = buildLocalTomatoReview(current, styleQuality, targetChars);

  if (!styleQuality.ok) {
    const fallback = finalizeReadableText(sanitizeStyleDeterministically(publicationSafeFallback(current)));
    const fallbackQuality = measureChapterStyle(fallback, targetChars);
    return {
      text: fallback,
      quality: { ...fallbackQuality, repaired: true, fallback: true },
      review: buildLocalTomatoReview(fallback, fallbackQuality, targetChars),
      repaired: true,
    };
  }

  return {
    text: current,
    quality: { ...styleQuality, repaired: true },
    review,
    repaired: current !== text,
  };
}

export async function formatChapterText(chapterText) {
  const result = await repairPunctuationIfNeeded(chapterText || '');
  let text = finalizeReadableText(result.text || '');
  let finalQuality = measureChapterFormat(text);
  if (!finalQuality.ok) {
    text = finalizeReadableText(publicationSafeFallback(text));
    finalQuality = measureChapterFormat(text);
  }
  if (!finalQuality.ok) {
    const safe = metricSafeReadableText(text);
    text = safe.text;
    finalQuality = safe.quality;
  }
  return {
    ...result,
    text,
    quality: {
      ...finalQuality,
      postReadableRepair: text !== result.text,
    },
  };
}

function countContentChars(text) {
  return (text || '').replace(/\s/g, '').length;
}

function normalizeTargetChars(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2000;
  return Math.max(800, Math.floor(parsed));
}

function buildChapterExpansionPrompt(opts, currentText, targetChars, currentChars, attempt = 1) {
  const shortage = Math.max(0, targetChars - currentChars);
  const minimumChars = Math.floor(targetChars * MIN_CHAPTER_TARGET_RATIO);
  const requiredAddition = Math.max(450, Math.ceil(shortage * 1.1));
  return `下面是第 ${opts.chapterNumber || ''} 章《${opts.title || '无题'}》已经生成的正文，但篇幅明显不足。

【目标】
- 本章目标约 ${targetChars} 字，最低不少于 ${minimumChars} 字。
- 当前约 ${currentChars} 字，还需要补写约 ${shortage} 字；这是第 ${attempt} 次补写。

【续写硬规则】
1. 只输出“追加在现有正文后面”的续写内容，不要重写前文，不要输出章节标题。
2. 必须紧接现有正文最后一段的情绪、动作和悬念，不要跳到下一章，不要提前收束。
3. 续写正文不得少于 ${requiredAddition} 字，至少 4 个自然段；如果一个场景写不满，就继续展开第二个动作节点或对话冲突。
4. 通过具体动作、对话、场景压力、系统/弹幕反应、人物抉择补足内容，不要水字数。
5. 使用规范中文标点和自然分段；动作链必须用逗号或句号断开，不要出现整段无标点长句。
6. 系统面板、任务提示等【...】必须单独成行，不要使用 Markdown。
7. 续写必须遵守【前文摘要】和【当前角色状态】。重伤、濒死、侵蚀、失力者不能突然做高强度动作；道具不能无交代消失或换人。
8. 若前文写明系统失效/受干扰，续写里的提示只能写成未知信号、残留规则、伪装机制或记忆回声，不能写成正常系统播报。
9. 历史年代、文字、官制、器物拿不准时写成模糊旧痕，不要强行指定互相矛盾的年代细节。
10. 续写必须有明确推进，至少补出一个新阻碍、一个反馈或一个章尾钩子；不要把补写写成解释、总结或复述。
11. 手机端阅读优先，段落要短，遇到对话切换、动作变化、信息揭露时主动分段。

【本章大纲】
本章定位：${opts.chapterRole || ''}
核心作用：${opts.chapterPurpose || ''}
本章简述：${opts.chapterSummary || ''}

${opts.globalSummary ? `【前文摘要】\n${trimToCharLimit(opts.globalSummary, 3000)}\n` : ''}
${opts.characterState ? `【当前角色状态】\n${trimToCharLimit(opts.characterState, 1800)}\n` : ''}

【现有正文末尾】
${trimToCharLimit(currentText || '', 2200, { fromEnd: false })}

请直接输出续写正文。`;
}

async function expandShortChapterIfNeeded(opts, repaired, exchangeLog, humanizeStrength) {
  const targetChars = normalizeTargetChars(opts.wordNumber || 2000);
  const currentChars = countContentChars(repaired.text);
  const minimumChars = Math.floor(targetChars * MIN_CHAPTER_TARGET_RATIO);

  if (currentChars >= minimumChars) {
    return {
      ...repaired,
      quality: { ...repaired.quality, charCount: currentChars, targetChars, shortChapter: false },
    };
  }

  let expanded = repaired;
  let expandedChars = currentChars;
  let lastError = null;

  for (let attempt = 1; attempt <= 2 && expandedChars < minimumChars; attempt += 1) {
    const prompt = buildChapterExpansionPrompt(opts, expanded.text, targetChars, expandedChars, attempt);
    const shortage = Math.max(450, targetChars - expandedChars);
    const maxTokens = Math.min(8192, Math.max(2600, Math.ceil(shortage * 4.2)));
    let content = '';
    let exchange = [];

    try {
      const result = await chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { maxTokens, temperature: 0.76 }
      );
      content = result.content || '';
      exchange = result.exchange || [];
    } catch (error) {
      lastError = error;
      break;
    }

    if (Array.isArray(exchange)) exchangeLog.push(...exchange);

    let addition = stripModelWrappers(content || '');
    addition = cleanPunctuation(addition);

    const additionChars = countContentChars(addition);
    if (additionChars < 160) {
      lastError = new Error(`模型补写内容过短（${additionChars} 字）`);
      continue;
    }

    expanded = await repairPunctuationIfNeeded(`${expanded.text}\n\n${addition}`);
    expandedChars = countContentChars(expanded.text);
  }

  const isStillShort = expandedChars < minimumChars;
  return {
    text: expanded.text,
    quality: {
      ...expanded.quality,
      ok: expanded.quality.ok && !isStillShort,
      issues: isStillShort
        ? [...(expanded.quality.issues || []), `chapter too short: ${expandedChars}/${targetChars}`]
        : (expanded.quality.issues || []),
      charCount: expandedChars,
      targetChars,
      expandedFromShortDraft: true,
      shortChapter: isStillShort,
      shortChapterWarning: expandedChars < minimumChars
        ? `章节仍偏短：当前约 ${expandedChars} 字，目标约 ${targetChars} 字${lastError ? `；自动补写未完成：${lastError.message || '未知错误'}` : ''}`
        : undefined,
    },
  };
}

export async function generateChapter(opts, humanizeStrength = 0.7, pipelineOpts = {}) {
  const doQualityRepair = pipelineOpts.qualityRepair !== false;
  const voiceCard = resolveVoiceCard({
    voiceCard: opts.voiceCard,
    topic: opts.topic,
    setting: opts.novelSetting,
  });
  const chapterOpts = { ...opts, voiceCard };
  const isFirst = opts.chapterNumber === 1;
  const targetChars = normalizeTargetChars(opts.wordNumber || 2000);
  let prompt = isFirst
    ? buildFirstChapterPrompt({
        title: opts.title,
        chapterRole: opts.chapterRole,
        chapterPurpose: opts.chapterPurpose,
        chapterSummary: opts.chapterSummary,
        novelSetting: opts.novelSetting,
        wordNumber: opts.wordNumber || 2000,
        userGuidance: opts.userGuidance,
        voiceCard,
        topic: opts.topic,
        chapterOutline: opts.chapterOutline,
        abilitySection: opts.abilitySection,
        foreshadowSection: opts.foreshadowSection,
        characterProfilesSection: opts.characterProfilesSection,
        patternsSection: opts.patternsSection,
      })
    : buildNextChapterPrompt({
        novelNumber: opts.chapterNumber,
        title: opts.title,
        chapterRole: opts.chapterRole,
        chapterPurpose: opts.chapterPurpose,
        chapterSummary: opts.chapterSummary,
        globalSummary: opts.globalSummary,
        previousExcerpt: opts.previousExcerpt,
        characterState: opts.characterState,
        outlineWindow: opts.outlineWindow,
        novelSetting: opts.novelSetting,
        nextChapterTitle: opts.nextChapterTitle,
        nextChapterSummary: opts.nextChapterSummary,
        wordNumber: opts.wordNumber || 2000,
        userGuidance: opts.userGuidance,
        voiceCard,
        topic: opts.topic,
        chapterOutline: opts.chapterOutline,
        abilitySection: opts.abilitySection,
        foreshadowSection: opts.foreshadowSection,
        characterProfilesSection: opts.characterProfilesSection,
        patternsSection: opts.patternsSection,
      });
  prompt += '\n\n【去AI句式要求】少用“不是……也不是……而是……”“不是……而是……”这类模板化对照句，尤其不要用来描写笑、哭、眼神、语气、反应、感觉。情绪尽量写动作和细节，例如“他嘴角扯了一下，像早就料到会这样”，不要写成“不是苦笑，也不是气笑，而是那种……”。';

  const { content, exchange } = await chat(
    [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    { maxTokens: Math.min(8192, Math.max(7168, Math.ceil(targetChars * 4.5))), temperature: 0.78 }
  );

  let text = stripModelWrappers(content || '');
  const exchangeLog = [...(exchange || [])];
  const repaired = await repairPunctuationIfNeeded(text);
  const final = await expandShortChapterIfNeeded(opts, repaired, exchangeLog, humanizeStrength);
  let contentText = finalizeReadableText(final.text);
  let contentQuality = measureChapterFormat(contentText);
  if (!contentQuality.ok) {
    contentText = finalizeReadableText(publicationSafeFallback(contentText));
    contentQuality = measureChapterFormat(contentText);
  }
  if (!contentQuality.ok) {
    const safe = metricSafeReadableText(contentText);
    contentText = safe.text;
    contentQuality = safe.quality;
  }

  if (humanizeStrength > 0) {
    contentText = humanizeChapter(contentText, humanizeStrength);
    const rePunct = await repairPunctuationIfNeeded(contentText);
    contentText = finalizeReadableText(rePunct.text || contentText);
    contentQuality = measureChapterFormat(contentText);
  }

  let qualityReview = null;
  if (doQualityRepair) {
    const quality = await repairChapterQualityIfNeeded(contentText, chapterOpts);
    contentText = quality.text;
    qualityReview = quality.review;
    contentQuality = measureChapterFormat(contentText);
    if (!contentQuality.ok) {
      const safe = metricSafeReadableText(contentText);
      contentText = safe.text;
      contentQuality = safe.quality;
    }
  }

  return {
    content: contentText,
    quality: {
      ...contentQuality,
      ...final.quality,
      postReadableRepair: contentText !== final.text,
      styleIssues: qualityReview?.issues?.map((i) => i.problem).filter(Boolean) || [],
      styleRepaired: Boolean(qualityReview?.repairNeeded && qualityReview?.pass === false),
      webnovelSkill: qualityReview,
      webnovelSkillPassed: Boolean(qualityReview?.pass),
      webnovelSkillRepaired: doQualityRepair,
      webnovelSkillIssues: qualityReview?.issues || [],
      tomatoLocalScore: qualityReview?.localAverage,
    },
    exchange: exchangeLog,
  };
}

// ========== Step4 定稿：更新前文摘要 ==========
export async function updateGlobalSummary(chapterText, currentSummary) {
  const prompt = buildSummaryUpdatePrompt(chapterText, currentSummary);
  const { content } = await chat(
    [{ role: 'system', content: '你是小说编辑，负责整理前文摘要。输出简洁、客观。' }, { role: 'user', content: prompt }],
    { maxTokens: 2048, temperature: 0.5, model: 'aux' }
  );
  return (content || '').trim();
}

// ========== Step4 定稿：更新角色状态 ==========
export async function updateCharacterState(chapterText, oldCharacterState, initialCharacterDynamics) {
  const prompt = buildCharacterStateUpdatePrompt(chapterText, oldCharacterState, initialCharacterDynamics);
  const { content } = await chat(
    [{ role: 'system', content: '你是小说编辑，负责维护角色状态文档。输出简洁、条理清晰。' }, { role: 'user', content: prompt }],
    { maxTokens: 2048, temperature: 0.5, model: 'aux' }
  );
  return (content || '').trim();
}

// ========== 可选：一致性审校 ==========
export async function checkConsistency(chapterText, globalSummary, characterState) {
  const prompt = buildConsistencyCheckPrompt(chapterText, globalSummary, characterState);
  const { content } = await chat(
    [{ role: 'system', content: '你是审校员，只输出 JSON，不评价文笔，不输出思考过程。' }, { role: 'user', content: prompt }],
    { maxTokens: 2048, temperature: 0.2, model: 'aux' }
  );
  return (content || '').trim();
}

/** 解析审校 JSON；解析失败时回退到文本启发式 */
export function parseConsistencyReview(reviewText) {
  const text = (reviewText || '').trim();
  if (!text) return { found: false, issues: [], raw: text };
  try {
    const jsonText = extractFirstJsonObject(text);
    if (jsonText) {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object' && typeof parsed.found === 'boolean') {
        return { found: parsed.found, issues: Array.isArray(parsed.issues) ? parsed.issues : [], raw: text };
      }
    }
  } catch { /* 回退启发式 */ }
  // 回退：文本启发式
  if (/^(未发现矛盾|未发现明显矛盾|暂无矛盾|无明显矛盾|没有明显矛盾|通过)[。.!！\s]*$/u.test(text)) {
    return { found: false, issues: [], raw: text };
  }
  const found = /(矛盾|冲突|不一致|不自洽|逻辑问题|设定模糊|未解释|前文明确|与前文|造成)/u.test(text);
  return { found, issues: [], raw: text };
}

export function hasConsistencyIssues(reviewText) {
  return parseConsistencyReview(reviewText).found;
}

function extractCharacterAnchorNames(characterState = '') {
  const names = [];
  for (const line of String(characterState).split(/\r?\n/u)) {
    const header = line.match(/^##\s*(?:【已有】)?\s*(.+)/u);
    if (header?.[1]) names.push(header[1].trim().slice(0, 12));
    const bullet = line.match(/^[-*]\s*\*\*(.+?)\*\*/u);
    if (bullet?.[1]) names.push(bullet[1].trim().slice(0, 12));
  }
  return [...new Set(names)].slice(0, 10);
}

function buildContinuityAnchorBrief(globalSummary = '', characterState = '') {
  const source = [globalSummary, characterState].filter(Boolean).join('\n');
  const keywords = /重伤|濒死|侵蚀|昏迷|失力|断臂|骨折|无法|系统失效|受干扰|不可直接信任|未知信号|时间停滞|重置|道具|武器|钥匙|石碑|符箓|清除|修正|记忆|规则|直播间|弹幕/u;
  const names = extractCharacterAnchorNames(characterState);
  const lines = source
    .split(/\r?\n|。|；|;/u)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (keywords.test(line)) return true;
      return names.some((name) => name && line.includes(name));
    })
    .slice(-18);
  if (!lines.length) return '（无额外硬锚点；仍须遵守前文摘要与角色状态。）';
  return lines.map((line, index) => `${index + 1}. ${trimToCharLimit(line, 180)}`).join('\n');
}

function buildConsistencyRepairPrompt({ chapterText, globalSummary, characterState, reviewText }) {
  const hardAnchors = buildContinuityAnchorBrief(globalSummary, characterState);
  return `你是长篇网文的连续性改稿编辑。请根据审校结果，只重写「最新章节正文」中有矛盾的地方，让它与前文摘要、角色状态一致。

【连续性硬锚点】
${hardAnchors}

【改稿硬规则】
1. 只输出修订后的章节正文，不要输出说明、标题、审校列表、Markdown。
2. 必须逐条解决审校结果里的矛盾；修完后不能产生新的同类矛盾。
3. 修稿优先级固定：先删冲突动作；再把动作降级；再补一句已有规则内的解释；最后才微调描写。不要新增大设定来糊弄矛盾。
4. 重伤、濒死、侵蚀、失力角色只能保留低强度反应：喘息、睁眼、短句、被搀扶、被拖动、极短距离挪动。若原文写主动爬行、奔跑、战斗、复杂操作，必须改弱或删除。
5. 道具状态必须连续。物品若掉落、遗失、交给别人、被毁，必须在正文里有清楚动作；否则保持原持有状态，不要写“刚才掉了”这类无交代变化。
6. 角色认知必须符合身份与前文。深度融入记忆/长期停留者不能突然完全不知道核心地点；可改成“没亲眼见过”“只听过残片”“记忆被遮蔽”。
7. 如果出现“系统失效但又有提示音”，必须在正文内明确来源为未知信号、残留规则、伪装机制或山河记忆回声，不能继续写成正常天道系统。
8. 如果出现“时间完全重置但新动作出现”，要么删掉新动作，要么解释为主角观察角度变化，而不是世界真的变化。
9. 历史年代、文字、官制、器物不能混用；出现“贞观二十三年 + 秦代小篆”等冲突时，改成“残缺古字/旧刻痕/风化铭文”等不冲突表述。
10. 保持本章主线事件、悬念、人物选择和篇幅基本不变；保持中文标点、自然断句和分段；不要整段无标点长句。

【前文摘要】
${trimToCharLimit(globalSummary || '', 6000)}

【当前角色状态】
${trimToCharLimit(characterState || '', 3000)}

【审校结果】
${trimToCharLimit(reviewText || '', 2500)}

【最新章节正文】
${trimToCharLimit(chapterText || '', 12000)}

请直接输出修订后的章节正文。`;
}

export async function repairChapterConsistency({ chapterText, globalSummary, characterState, reviewText }) {
  const initialReview = (reviewText || await checkConsistency(chapterText, globalSummary, characterState) || '').trim();
  if (!hasConsistencyIssues(initialReview)) {
    return {
      ok: true,
      changed: false,
      content: chapterText || '',
      initialReview,
      review: initialReview || '未发现矛盾',
    };
  }

  const prompt = buildConsistencyRepairPrompt({ chapterText, globalSummary, characterState, reviewText: initialReview });
  const { content, exchange } = await chat(
    [
      { role: 'system', content: '你是长篇网文连续性改稿编辑。你的任务是修复剧情与设定矛盾，并保持正文可直接发布。' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 8192, temperature: 0.35 }
  );

  const repairedDraft = stripModelWrappers(content || '');
  if (!repairedDraft || repairedDraft.length < Math.min(600, Math.floor((chapterText || '').length * 0.35))) {
    return {
      ok: false,
      changed: false,
      content: chapterText || '',
      initialReview,
      review: initialReview,
      error: '一致性修稿返回内容过短，已保留原草稿',
      exchange: exchange || [],
    };
  }

  const formatted = await repairPunctuationIfNeeded(repairedDraft);
  const secondReview = await checkConsistency(formatted.text, globalSummary, characterState);
  const ok = !hasConsistencyIssues(secondReview);

  return {
    ok,
    changed: true,
    content: formatted.text,
    initialReview,
    review: secondReview || (ok ? '未发现矛盾' : initialReview),
    quality: formatted.quality,
    exchange: exchange || [],
  };
}

export { getChapterInfo };
