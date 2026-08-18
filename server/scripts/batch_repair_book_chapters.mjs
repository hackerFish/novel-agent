import fs from 'fs';
import path from 'path';
import {
  formatChapterText,
  repairChapterStyleIfNeeded,
  repairByWebnovelSkillIfNeeded,
} from '../src/writer/generator.js';
import { reduceAiContrastSyntax } from '../src/writer/humanize.js';

const FULL_STOPS = '。！？!?';
const CLOSING_QUOTES = '”’」』';
const OPENING_QUOTES = '“‘「『';
const FRAGMENT_START_RE =
  /^(那些|这些|这个|那个|这种|那种|这样|那样|其中|甚至|还有|以及|剩下|更多|最后|仿佛|像是|像|把|将|被|让|朝|向|从|在|于|比|跟|和|与|及|而|但|却|可|于是|然后|直到|因为|所以|只是|如果|否则|并且|而且|尤其|包括|连|连同)/u;
const CONTINUATION_START_RE =
  /^(的|地|得|了|着|过|很|更|再|又|还|也|都|并|而|但|却|像|如|从|在|向|把|被|让|将|给|对|比|跟|和|与|及|或|并且|而且|所以|因为|如果|然后|随后|紧接着|与此同时|这时|此时|旋即|紧跟着|很快|可见|不是|而是|上|下|前|后|里|内|外|中|间|来|去|开|出|进|回|紧|慢慢|忽然|突然)/u;

function normalizeBasicPunctuation(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,/g, '，')
    .replace(/!/g, '！')
    .replace(/\?/g, '？')
    .replace(/:/g, '：')
    .replace(/;/g, '；')
    .replace(/\.{3,}/g, '……')
    .replace(/([，。！？；：“”‘’、])\s+/gu, '$1')
    .replace(/\s+([，。！？；：“”‘’、])/gu, '$1')
    .trim();
}

function splitIntoSentenceParagraphs(text) {
  const normalized = normalizeBasicPunctuation(text);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const output = [];
  for (const paragraph of paragraphs) {
    if (/^#{1,6}\s/u.test(paragraph) || /^【[^】]+】$/u.test(paragraph)) {
      output.push(paragraph);
      continue;
    }

    const compact = paragraph.replace(/\s+/g, ' ').trim();
    const sentences =
      compact.match(/[^。！？!?…]+(?:……|[。！？!?…]+[”’」』]?|$)/gu) || [compact];

    for (const raw of sentences) {
      const sentence = raw.trim();
      if (sentence) output.push(sentence);
    }
  }

  return output.join('\n\n').trim();
}

function ensureParagraphTerminalPunctuation(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const fixed = paragraphs.map((paragraph) => {
    if (/^#{1,6}\s/u.test(paragraph)) {
      return paragraph.replace(/^#{1,6}\s*/u, '');
    }

    if (/^【[^】]+】$/u.test(paragraph)) {
      return paragraph;
    }

    let line = paragraph
      .replace(/^#{1,6}\s*/u, '')
      .replace(/([。！？!?…])([”’」』])/gu, '$1$2')
      .trim();

    if (!line) return line;

    if (/[。！？!?…]$/.test(line) || /[。！？!?…][”’」』]$/.test(line)) {
      return line;
    }

    if (/[，、；：]$/.test(line)) {
      return `${line.slice(0, -1)}。`;
    }

    if (/[”’」』]$/.test(line)) {
      return `${line}。`;
    }

    if (/[-—]$/.test(line)) {
      return line;
    }

    return `${line}。`;
  });

  return fixed.join('\n\n').trim();
}

function normalizeChapterHeading(text) {
  return String(text || '')
    .replace(/^\s*#*\s*第(\d+)章[。．\s]*/gmu, '第$1章\n\n')
    .replace(/^\s*第(\d+)章。/gmu, '第$1章');
}

function improveDialogueAndPauses(text) {
  let value = String(text || '');

  value = value
    .replace(/([。！？!?…][”’」』]?)(?=“)/gu, '$1\n\n')
    .replace(/([。！？!?…][”’」』]?)(?=【)/gu, '$1\n\n')
    .replace(/([”’」』])(?=“)/gu, '$1\n\n')
    .replace(/([”’」』])(?=[一-龥]{2,8}(?:说|问|喊|道|低声|开口|回答|骂|吼))/gu, '$1\n\n')
    .replace(/([一-龥])(?=“[^”]{1,30}”[一-龥]{2,8}(?:说|问|喊|道))/gu, '$1')
    .replace(/”(?=[一-龥]{2,8}(?:说|问|喊|道|低声|开口|回答))/gu, '”\n\n')
    .replace(/([。！？!?…])([一-龥]{2,8}(?:说|问|喊|道|低声|开口|回答))/gu, '$1\n\n$2');

  const pauseCues = [
    '林照',
    '周烈',
    '沈知夏',
    '陈老饼',
    '赵锐',
    '许妙音',
    '系统',
    '面板',
    '弹幕',
    '片刻后',
    '下一秒',
    '与此同时',
    '紧接着',
    '这时',
    '外面',
    '门外',
  ];

  for (const cue of pauseCues) {
    const re = new RegExp(`([^。！？!?…\\n]{34,})(${cue})`, 'gu');
    value = value.replace(re, '$1。$2');
  }

  value = value
    .replace(/([一-龥])——不是/gu, '$1。不是')
    .replace(/([一-龥])——像/gu, '$1。像')
    .replace(/([一-龥])但([一-龥]{8,})/gu, '$1。但$2')
    .replace(/([一-龥])而([一-龥]{8,})/gu, '$1。而$2')
    .replace(/([一-龥])像([一-龥]{10,})/gu, '$1。像$2')
    .replace(/([一-龥])不是([一-龥]{10,})而是/gu, '$1。不是$2而是')
    .replace(/\n{3,}/g, '\n\n');

  return value.trim();
}

function mergeBrokenParagraphs(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  const merged = [];
  for (const paragraph of paragraphs) {
    if (!merged.length) {
      merged.push(paragraph);
      continue;
    }

    const prev = merged[merged.length - 1];
    const prevLast = prev.slice(-1);
    const shouldMerge =
      paragraph.length <= 2 ||
      (/^[一-龥]{1,10}$/u.test(paragraph.replace(/[。！？!?…]/g, '')) &&
        paragraph.length <= 12) ||
      (paragraph.length <= 18 && FRAGMENT_START_RE.test(paragraph)) ||
      CONTINUATION_START_RE.test(paragraph) ||
      /[，、；：——…“‘「『]$/u.test(prev) ||
      !FULL_STOPS.includes(prevLast);

    if (shouldMerge) {
      merged[merged.length - 1] = `${prev}${paragraph}`;
    } else {
      merged.push(paragraph);
    }
  }

  return merged.join('\n\n');
}

function cleanupParagraphArtifacts(text) {
  return String(text || '')
    .replace(/^\s*#*\s*第(\d+)章[。．\s]*/gmu, '第$1章\n\n')
    .replace(/([。！？!?…])\n\n([”’」』])/gu, '$1$2')
    .replace(/([“‘「『])\n\n/gu, '$1')
    .replace(/([一-龥])\n\n([”’」』])/gu, '$1$2')
    .replace(/([，。！？；：“”‘’、])([“‘「『])/gu, '$1$2')
    .replace(/([一-龥])，(?=(的|地|得|了|着|过|很|更|再|又|还|也|都|并|而|但|却|像|如|从|在|向|把|被|让|将|给|对|上|下|前|后|里|内|外|中|间|来|去|开|出|进|回|紧|慢慢|忽然|突然))/gu, '$1')
    .replace(/([一-龥])。(?=(可见|很久|不是|而是|从|在|向|把|被|让|将|给|对|上|下|前|后|里|内|外|中|间))/gu, '$1')
    .replace(/——。/gu, '——')
    .replace(/([一-龥])，的/gu, '$1的')
    .replace(/([一-龥])，地/gu, '$1地')
    .replace(/([一-龥])，得/gu, '$1得')
    .replace(/([一-龥])。可见/gu, '$1可见')
    .replace(/([一-龥])。很久/gu, '$1很久')
    .replace(/([一-龥])，不是/gu, '$1不是')
    .replace(/([一-龥])。(?=([一-龥]{1,3})的)/gu, '$1')
    .replace(/([一-龥])。(?=([一-龥]{1,3})地)/gu, '$1')
    .replace(/([一-龥])。(?=([一-龥]{1,3})得)/gu, '$1')
    .replace(/([一-龥])。\n\n(?=(像|如同|仿佛|终于|忽然|突然))/gu, '$1')
    .replace(/([一-龥])。(?=(像|如同|仿佛))/gu, '$1')
    .replace(/([一-龥])、。\n\n/gu, '$1，')
    .replace(/([一-龥])、。/gu, '$1，')
    .replace(/([一-龥])。\n\n(?=但)/gu, '$1。')
    .replace(/([一-龥])。\n\n(?=而)/gu, '$1。')
    .replace(/([一-龥])。\n\n(?=不是)/gu, '$1。')
    .replace(/(得|的|地)。\n\n(?=[一-龥])/gu, '$1')
    .replace(/吞咽。\n\n那些快要脱口而出的真话。/gu, '吞咽那些快要脱口而出的真话。')
    .replace(/瘦得。\n\n可怜/gu, '瘦得可怜')
    .replace(/([一-龥])，\n\n(?=[一-龥])/gu, '$1')
    .replace(/距离。很轻微/gu, '距离很轻微')
    .replace(/脱口。而出/gu, '脱口而出')
    .replace(/看向。([一-龥])/gu, '看向$1')
    .replace(/因为。([一-龥])/gu, '因为$1')
    .replace(/然后。([一-龥])/gu, '然后$1')
    .replace(/不是正常刷屏——是/gu, '不是正常刷屏。\n\n是')
    .replace(/“([^”]{1,20})”。“([^”]{1,20})”/gu, '“$1”\n\n“$2”')
    .replace(/】“/gu, '】\n\n“')
    .replace(/】(?=【)/gu, '】\n\n')
    .replace(/。(?=【)/gu, '。\n\n')
    .replace(/声音不大。但/gu, '声音不大，但')
    .replace(/弹幕还在刷。但/gu, '弹幕还在刷，但')
    .replace(/那种节奏感太强了，强到。/gu, '那种节奏感太强了，强到')
    .replace(/碎掉了又。像/gu, '碎掉了，又像')
    .replace(/每次都，因为/gu, '每次都因为')
    .replace(/“你刚才说”。/gu, '“你刚才说，”')
    .replace(/“但你记得被人叫出来是什么感觉”。/gu, '“但你记得被人叫出来是什么感觉。”')
    .replace(/【([^】]+)】(?=[一-龥])/gu, '【$1】\n\n')
    .replace(/([一-龥])\.(?=[一-龥])/gu, '$1。')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function localFallbackFormat(text) {
  let normalized = improveDialogueAndPauses(normalizeChapterHeading(normalizeBasicPunctuation(text)));
  const cues = [
    '但',
    '可',
    '而',
    '忽然',
    '突然',
    '这时',
    '下一秒',
    '片刻后',
    '随后',
    '紧接着',
    '与此同时',
    '林照',
    '周烈',
    '陈老饼',
    '赵锐',
    '面板',
    '系统',
    '弹幕',
    '门外',
    '外面',
  ];

  for (const cue of cues) {
    const re = new RegExp(`([^。！？!?…\\n]{36,})(${cue})`, 'gu');
    normalized = normalized.replace(re, '$1。$2');
  }

  normalized = normalized
    .replace(/([】”’」』])(?=[“‘「『一-龥])/gu, '$1\n\n')
    .replace(/([。！？!?…])(?=[“‘「『【一-龥])/gu, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const split = splitIntoSentenceParagraphs(normalized);
  const merged = mergeBrokenParagraphs(split);
  return cleanupParagraphArtifacts(
    improveDialogueAndPauses(ensureParagraphTerminalPunctuation(merged)),
  );
}

function buildBackupPath(filePath) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.json');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `${base}.before-batch-repair-${stamp}.json`);
}

async function repairChapterText(text, opts = {}) {
  const reduced = reduceAiContrastSyntax(String(text || ''));
  if (process.env.FAST_LOCAL_ONLY === '1') {
    return {
      text: cleanupParagraphArtifacts(
        improveDialogueAndPauses(
          ensureParagraphTerminalPunctuation(
            mergeBrokenParagraphs(splitIntoSentenceParagraphs(localFallbackFormat(reduced))),
          ),
        ),
      ),
      quality: null,
    };
  }

  let firstPass = reduced;
  let quality = null;

  try {
    const formatted = await formatChapterText(reduced);
    firstPass = formatted.text || reduced;
    quality = formatted.quality || null;
  } catch {
    firstPass = localFallbackFormat(reduced);
  }

  let sentenceSplit = cleanupParagraphArtifacts(
    improveDialogueAndPauses(
      ensureParagraphTerminalPunctuation(
        mergeBrokenParagraphs(splitIntoSentenceParagraphs(firstPass)),
      ),
    ),
  );

  try {
    const styleRepair = await repairChapterStyleIfNeeded(sentenceSplit, opts);
    sentenceSplit = improveDialogueAndPauses(
      ensureParagraphTerminalPunctuation(styleRepair.text || sentenceSplit),
    );
  } catch {
    sentenceSplit = cleanupParagraphArtifacts(
      improveDialogueAndPauses(
        ensureParagraphTerminalPunctuation(mergeBrokenParagraphs(sentenceSplit)),
      ),
    );
  }

  try {
    const webnovelRepair = await repairByWebnovelSkillIfNeeded(sentenceSplit, opts);
    sentenceSplit = improveDialogueAndPauses(
      ensureParagraphTerminalPunctuation(webnovelRepair.text || sentenceSplit),
    );
  } catch {
    sentenceSplit = cleanupParagraphArtifacts(
      improveDialogueAndPauses(
        ensureParagraphTerminalPunctuation(mergeBrokenParagraphs(sentenceSplit)),
      ),
    );
  }

  let finalText = sentenceSplit;
  try {
    const finalFormatted = await formatChapterText(sentenceSplit);
    finalText = cleanupParagraphArtifacts(
      improveDialogueAndPauses(
        ensureParagraphTerminalPunctuation(
          mergeBrokenParagraphs(splitIntoSentenceParagraphs(finalFormatted.text || sentenceSplit)),
        ),
      ),
    );
    quality = finalFormatted.quality || quality;
  } catch {
    finalText = localFallbackFormat(sentenceSplit);
  }

  return {
    text: finalText,
    quality,
  };
}

async function main() {
  const [, , fileArg, startArg = '8', chapterListArg = ''] = process.argv;
  if (!fileArg) {
    throw new Error('Usage: node scripts/batch_repair_book_chapters.mjs <book-json-path> [startChapter]');
  }

  const filePath = path.resolve(fileArg);
  const startChapter = Math.max(1, Number(startArg || 8));
  const raw = fs.readFileSync(filePath, 'utf8');
  const book = JSON.parse(raw);
  const drafted = book.draftedChapters || {};
  const repairOpts = {
    wordNumber: book.wordPerChapter || 2200,
    globalSummary: book.globalSummary || '',
    characterState: book.characterState || '',
  };
  const chapterNumbers = Object.keys(drafted)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const explicitTargets = chapterListArg
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num) && num >= startChapter);
  const targets = explicitTargets.length
    ? chapterNumbers.filter((num) => explicitTargets.includes(num))
    : chapterNumbers.filter((num) => num >= startChapter);
  if (!targets.length) {
    console.log(`No chapters >= ${startChapter}`);
    return;
  }

  const backupPath = buildBackupPath(filePath);
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  const stats = [];
  for (const num of targets) {
    const original = String(drafted[String(num)] || '');
    const repaired = await repairChapterText(original, repairOpts);
    book.draftedChapters[String(num)] = repaired.text;
    stats.push({
      chapter: num,
      before: original.length,
      after: repaired.text.length,
      issues: repaired.quality?.issues || [],
    });
    console.log(`Repaired chapter ${num}: ${original.length} -> ${repaired.text.length}`);
    if (stats.length % 5 === 0) {
      fs.writeFileSync(filePath, JSON.stringify(book, null, 2), 'utf8');
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(book, null, 2), 'utf8');
  console.log(`Saved repaired book: ${filePath}`);
  console.log(`Chapters repaired: ${stats.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
