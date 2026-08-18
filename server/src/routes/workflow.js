import { Router } from 'express';
import {
  generateSetting,
  generateDirectory,
  generateDirectoryFix,
  validateDirectory,
  parseDirectoryToChapters,
  getChapterInfo,
  generateChapter,
  formatChapterText,
  updateGlobalSummary,
  updateCharacterState,
  checkConsistency,
  repairChapterConsistency,
} from '../writer/generator.js';
import { runChapterPipeline } from '../writer/chapterPipeline.js';
import { LINZHAO_VOICE_CARD, resolveVoiceCard } from '../writer/voiceCard.js';
import { chat } from '../llm/adapter.js';
import { buildDirectorOutlinePrompt, buildChapterOutlinePrompt } from '../writer/directorOutline.js';
import { formatAbilitySection, formatForeshadowSection } from '../writer/bookState.js';
import { runDeconstruct, getPatterns, formatPatternsSection } from '../writer/deconstruct.js';

/** 从请求注入能力图鉴与伏笔状态（bookId 存在时） */
function injectBookState(opts) {
  const { bookId } = opts || {};
  if (!bookId || typeof bookId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(bookId)) return opts;
  const chapterNumber = Number(opts.novelNumber || opts.chapterNumber) || 0;
  try {
    return {
      ...opts,
      abilitySection: formatAbilitySection(bookId, chapterNumber) || undefined,
      foreshadowSection: formatForeshadowSection(bookId, chapterNumber) || undefined,
    };
  } catch {
    return opts;
  }
}

export const workflowRouter = Router();

async function generateValidatedDirectorySegment(novelSetting, numChapters, options) {
  const INTERNAL_CHUNK_SIZE = 5;
  const messages = [];
  const segments = [];
  let rollingSummary = options.previousVolumeSummary || '';

  for (let start = options.volumeStart; start <= options.volumeEnd; start += INTERNAL_CHUNK_SIZE) {
    const end = Math.min(start + INTERNAL_CHUNK_SIZE - 1, options.volumeEnd);
    const chunkOptions = {
      volumeStart: start,
      volumeEnd: end,
      previousVolumeSummary: rollingSummary || undefined,
    };
    let result = await generateDirectory(novelSetting, numChapters, chunkOptions);
    let directory = result.content || '';
    if (result.exchange && result.exchange.length) {
      messages.push({ role: 'system', content: `[生成第 ${start}–${end} 章]` });
      messages.push(...result.exchange);
    }

    let validation = validateDirectory(directory, start, end);
    let fixAttempts = 0;
    while (!validation.ok && validation.errors.length > 0 && fixAttempts < 2) {
      fixAttempts += 1;
      const fixResult = await generateDirectoryFix(validation.errors, directory, start, end);
      if (fixResult.exchange && fixResult.exchange.length) {
        messages.push({ role: 'system', content: `[自动修正第 ${start}–${end} 章]` });
        messages.push(...fixResult.exchange);
      }
      directory = fixResult.content || directory;
      validation = validateDirectory(directory, start, end);
    }

    if (!validation.ok) {
      return {
        ok: false,
        directory: [...segments, directory].filter(Boolean).join('\n\n'),
        validation,
        messages,
        failedStart: start,
        failedEnd: end,
      };
    }

    const cleanSegment = directory.trim();
    segments.push(cleanSegment);
    rollingSummary = `${rollingSummary}\n\n${cleanSegment}`.trim().slice(-3000);
  }

  return {
    ok: true,
    directory: segments.join('\n\n'),
    validation: { ok: true, errors: [] },
    messages,
  };
}

/** Step1 生成设定 */
workflowRouter.post('/step1-setting', async (req, res) => {
  try {
    const { topic, genre, numChapters, wordPerChapter } = req.body || {};
    const result = await generateSetting(topic, genre, numChapters, wordPerChapter);
    const content = typeof result === 'string' ? result : result.content;
    const messages = typeof result === 'string' ? [] : (result.exchange || []);
    res.json({ ok: true, setting: content, messages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step2 生成目录（校验格式，不合格则自动让 AI 修正一次；返回与 AI 对答供展示） */
workflowRouter.post('/step2-directory', async (req, res) => {
  try {
    let { novelSetting, numChapters, volumeStart, volumeEnd, previousVolumeSummary } = req.body || {};
    const MAX_PER_SEGMENT = 20;
    if (typeof volumeStart === 'number' && typeof volumeEnd === 'number') {
      volumeEnd = Math.min(volumeEnd, volumeStart + MAX_PER_SEGMENT - 1);
    }
    const options =
      typeof volumeStart === 'number' && typeof volumeEnd === 'number'
        ? { volumeStart, volumeEnd, previousVolumeSummary }
        : {};
    const isSegment = options.volumeStart != null && options.volumeEnd != null;

    if (isSegment) {
      const result = await generateValidatedDirectorySegment(novelSetting, numChapters, options);
      if (!result.ok) {
        return res.status(422).json({
          ok: false,
          error: `目录格式校验失败，未追加本批。请重试生成第 ${result.failedStart}–${result.failedEnd} 章。问题：${result.validation.errors.slice(0, 8).join(' ')}`,
          directory: result.directory,
          actualVolumeEnd: options.volumeEnd,
          validation: { ok: result.validation.ok, errors: result.validation.errors },
          messages: result.messages,
        });
      }
      return res.json({
        ok: true,
        directory: result.directory,
        actualVolumeEnd: options.volumeEnd,
        validation: result.validation,
        messages: result.messages,
      });
    }

    const result = await generateDirectory(novelSetting, numChapters, options);
    const directory = result.content;
    const messages = [...(result.exchange || [])];

    res.json({
      ok: true,
      directory,
      validation: isSegment ? null : { ok: true, errors: [] },
      messages,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 解析目录（前端可用来选章、展示） */
workflowRouter.post('/directory/parse', (req, res) => {
  try {
    const { rawDirectory } = req.body || {};
    const chapters = parseDirectoryToChapters(rawDirectory);
    res.json({ ok: true, chapters });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step3 生成章节 */
workflowRouter.post('/step3-chapter', async (req, res) => {
  try {
    const rawOpts = req.body || {};
    const humanizeStrength = typeof rawOpts.humanizeStrength === 'number' ? rawOpts.humanizeStrength : 0.7;
    const opts = injectBookState(rawOpts);
    const result = await generateChapter(opts, humanizeStrength, {
      qualityRepair: opts.stages?.qualityRepair !== false,
    });
    const content = typeof result === 'string' ? result : result.content;
    const messages = typeof result === 'string' ? [] : (result.exchange || []);
    const quality = typeof result === 'string' ? null : result.quality;
    res.json({ ok: true, content, quality, messages });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step3 单章完整 pipeline：生成 → 一致性 → Step4（支持 SSE 进度） */
workflowRouter.post('/chapter/pipeline', async (req, res) => {
  const stream = req.query.stream === '1';
  const send = (event) => {
    if (stream) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
    }

    const result = await runChapterPipeline(injectBookState(req.body || {}), send);

    if (stream) {
      send({ type: 'result', ...result });
      res.end();
      return;
    }

    if (!result.ok) {
      return res.status(result.content ? 422 : 500).json(result);
    }
    res.json(result);
  } catch (e) {
    if (stream) {
      send({ type: 'error', error: e.message });
      res.end();
      return;
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step3 整理章节格式：补标点、断句、分段 */
workflowRouter.post('/chapter/format', async (req, res) => {
  try {
    const { chapterText } = req.body || {};
    const result = await formatChapterText(chapterText || '');
    res.json({ ok: true, content: result.text, quality: result.quality });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step4 定稿：更新前文摘要 */
workflowRouter.post('/step4-summary', async (req, res) => {
  try {
    const { chapterText, currentSummary } = req.body || {};
    const summary = await updateGlobalSummary(chapterText, currentSummary);
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step4 定稿：更新角色状态 */
workflowRouter.post('/step4-character-state', async (req, res) => {
  try {
    const { chapterText, oldCharacterState, initialCharacterDynamics } = req.body || {};
    const characterState = await updateCharacterState(chapterText, oldCharacterState, initialCharacterDynamics);
    res.json({ ok: true, characterState });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 口吻卡预设 */
workflowRouter.get('/voice-card/presets', (_, res) => {
  res.json({
    ok: true,
    presets: {
      linzhao: LINZHAO_VOICE_CARD,
    },
  });
});

/** 可选：一致性审校 */
workflowRouter.post('/check-consistency', async (req, res) => {
  try {
    const { chapterText, globalSummary, characterState } = req.body || {};
    const result = await checkConsistency(chapterText, globalSummary, characterState);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Step3 一致性修稿：根据审校结果修正文，再复审 */
workflowRouter.post('/chapter/consistency-repair', async (req, res) => {
  try {
    const { chapterText, globalSummary, characterState, reviewText } = req.body || {};
    const result = await repairChapterConsistency({
      chapterText: chapterText || '',
      globalSummary: globalSummary || '',
      characterState: characterState || '',
      reviewText: reviewText || '',
    });
    const { ok: passed, ...rest } = result;
    res.json({ ok: true, passed, ...rest });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** ========== 导演式顶层大纲 ========== */

/** 生成全书导演大纲（分卷蓝图/爽点节奏/伏笔网络/人物弧光/结局） */
workflowRouter.post('/outline/director', async (req, res) => {
  try {
    const { novelSetting, topic, genre, numChapters, wordPerChapter, existingDirectory } = req.body || {};
    const prompt = buildDirectorOutlinePrompt({
      novelSetting, topic, genre,
      numChapters: numChapters || 200,
      wordPerChapter: wordPerChapter || 2000,
      existingDirectory,
    });
    const { content, exchange } = await chat(
      [{ role: 'system', content: '你是一位顶级网文主编兼导演，输出结构清晰的规划文本。' }, { role: 'user', content: prompt }],
      { maxTokens: 8192, temperature: 0.6 }
    );
    res.json({ ok: true, outline: content, messages: exchange });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 生成单章执行细纲（目标/开场钩/三段推进/爽点/章尾钩/伏笔/人设细节/字数分配） */
workflowRouter.post('/outline/chapter', async (req, res) => {
  try {
    const { directorOutline, novelSetting, chapterNumber, title, chapterRole, chapterPurpose, chapterSummary, volumeIndex } = req.body || {};
    const prompt = buildChapterOutlinePrompt({
      directorOutline, novelSetting,
      chapterNumber, title, chapterRole, chapterPurpose, chapterSummary, volumeIndex,
    });
    const { content, exchange } = await chat(
      [{ role: 'system', content: '你是执行导演，输出简洁的执行细纲。' }, { role: 'user', content: prompt }],
      { maxTokens: 3072, temperature: 0.5, model: 'aux' }
    );
    res.json({ ok: true, outline: content, messages: exchange });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 拆书分析（爆款逆向 → 写法库） ========== */

/** 拆书：输入书名/简介/章节样本 → 结构化拆解 → 存写法库 */
workflowRouter.post('/deconstruct', async (req, res) => {
  try {
    const { book, intro, sampleText, save = true } = req.body || {};
    if (!book) return res.status(400).json({ ok: false, error: '缺少书名' });
    const result = await runDeconstruct({ book, intro, sampleText, save: save !== false });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 查询写法库 */
workflowRouter.get('/patterns', (req, res) => {
  try {
    res.json({ ok: true, patterns: getPatterns() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 写法库摘要（可注入写章 prompt） */
workflowRouter.get('/patterns/section', (req, res) => {
  try {
    const max = Number(req.query.max) || 3;
    res.json({ ok: true, section: formatPatternsSection(getPatterns(), max) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export { getChapterInfo };
