/**
 * 书级生产路由：批量生产（断点续传+进度）+ 全书审计（番茄分/AI味）
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreTomatoReadability, collectTomatoLocalIssues } from '../writer/tomatoQuality.js';
import { getAbilities, getForeshadows } from '../writer/bookState.js';
import { scorePromotion, scorePromotionBook } from '../writer/promotionScore.js';
import { runChapterPipeline } from '../writer/chapterPipeline.js';
import { buildChapterOutlinePrompt } from '../writer/directorOutline.js';
import { chat } from '../llm/adapter.js';
import { thirdPartyReviewChapter } from '../writer/thirdPartyReview.js';
import { runAutoRepair, localRepair, checkMetaphorDensity } from '../writer/autoRepair.js';
import { runBookPolish } from '../writer/bookPolish.js';
import { locateAiFlavor } from '../writer/aiIndex.js';
import { runCommercialPack } from '../writer/commercialPack.js';
import { listChapterHistory, restoreChapterFile } from '../storage/chapterStorage.js';
import { fetchFanqieData, getCachedFanqieData, hasFanqieLogin } from '../publish/fanqieData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '..', '.t-book-books');

export const bookRouter = Router();

function safeBookId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function getBookPath(bookId) {
  return path.join(BOOKS_DIR, `${bookId}.json`);
}

function loadProject(bookId) {
  const p = getBookPath(bookId);
  if (!fs.existsSync(p)) throw new Error('书籍不存在');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveProject(bookId, project) {
  fs.writeFileSync(getBookPath(bookId), JSON.stringify(project, null, 2), 'utf8');
}

function chDir(bookId) {
  return path.join(BOOKS_DIR, 'chapters', bookId);
}

function readCh(bookId, n) {
  const f = path.join(chDir(bookId), `${n}.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

function parseChapter(directory, n) {
  const blocks = (directory || '').split(/\n\s*\n/);
  const block = blocks.find((b) => b.includes(`第${n}章`)) || '';
  return {
    title: (block.match(/第\d+章\s*-\s*([^\n]+)/) || [])[1]?.trim() || '',
    chapterRole: (block.match(/本章定位[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
    chapterPurpose: (block.match(/核心作用[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
    chapterSummary: (block.match(/本章简述[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
  };
}

/* ========== 批量生产任务（内存态） ========== */
const batchTasks = new Map(); // bookId -> { running, current, target, message, startedAt, stopRequested }

async function runBatch(bookId, toChapter) {
  const task = batchTasks.get(bookId);
  const project = loadProject(bookId);
  const setting = project.setting || '';
  const directorOutline = project.directorOutline || '';
  const directory = project.directory || '';
  const END = Math.min(Number(toChapter) || 0, project.numChapters || 500);
  let summary = project.globalSummary || '';
  let characters = project.characterState || '';
  let prevContent = readCh(bookId, (project.lastGeneratedChapter || 0));
  let n = (project.lastGeneratedChapter || 0) + 1;

  while (n <= END) {
    if (task?.stopRequested) {
      task.message = `已暂停于第 ${n - 1} 章`;
      break;
    }
    task.current = n;
    task.target = END;
    task.message = `生成第 ${n}/${END} 章`;
    try {
      const info = parseChapter(directory, n);
      // 细纲（进程内直接调用，避免 HTTP 超时）
      let chapterOutline = '';
      if (directorOutline) {
        const prompt = buildChapterOutlinePrompt({
          directorOutline: directorOutline.slice(0, 6000),
          novelSetting: setting.slice(0, 3000),
          chapterNumber: n,
          title: info.title,
          chapterRole: info.chapterRole,
          chapterPurpose: info.chapterPurpose,
          chapterSummary: info.chapterSummary,
          volumeIndex: Math.ceil(n / 50),
        });
        const o = await chat(
          [{ role: 'system', content: '你是执行导演，输出简洁的执行细纲。' }, { role: 'user', content: prompt }],
          { maxTokens: 3072, temperature: 0.5, model: 'aux' }
        );
        chapterOutline = o.content || '';
      }
      // 正文 pipeline（进程内直接调用）
      const r = await runChapterPipeline({
        bookId,
        novelNumber: n,
        title: info.title,
        chapterRole: info.chapterRole,
        chapterPurpose: info.chapterPurpose,
        chapterSummary: info.chapterSummary,
        novelSetting: setting.slice(0, 8000),
        setting,
        globalSummary: summary.slice(-16000),
        characterState: characters.slice(-8000),
        previousExcerpt: prevContent ? prevContent.slice(-3000) : undefined,
        nextChapterTitle: n < END ? parseChapter(directory, n + 1).title : '',
        nextChapterSummary: n < END ? parseChapter(directory, n + 1).chapterSummary : '',
        wordNumber: project.wordPerChapter || 2000,
        topic: project.topic || '',
        humanizeStrength: 0.85,
        chapterOutline: chapterOutline || undefined,
        stages: { consistency: true, finalize: true, qualityRepair: true },
      }, (ev) => {
        if (task && typeof ev.message === 'string') task.message = `第 ${n} 章：${ev.message}`;
      });
      if (!r.ok) throw new Error(r.error || 'pipeline 失败');
      fs.mkdirSync(chDir(bookId), { recursive: true });
      fs.writeFileSync(path.join(chDir(bookId), `${n}.txt`), r.content);
      summary = r.summary || summary;
      characters = r.characterState || characters;
      prevContent = r.content;
      project.globalSummary = summary;
      project.characterState = characters;
      project.lastGeneratedChapter = n;
      saveProject(bookId, project);

      // 自动审查修复（三方审查 → 补丁修复 → 本地清洗），未通过标记待修
      try {
        task.message = `第 ${n} 章：三方审查 + 修复中…`;
        const repaired = await runAutoRepair(r.content, {
          title: info.title,
          summary: info.chapterSummary,
          globalSummary: summary,
        }, { targetChars: project.wordPerChapter || 2000 });
        if (repaired.finalText !== r.content) {
          fs.writeFileSync(path.join(chDir(bookId), `${n}.txt`), repaired.finalText);
          prevContent = repaired.finalText;
        }
        task.message = `第 ${n}/${END} 章完成（审查${repaired.review?.summary?.verdict || '未审'}）`;
      } catch (e) {
        task.message = `第 ${n} 章完成（审查环节异常: ${e.message.slice(0, 60)}）`;
      }
    } catch (e) {
      task.message = `第 ${n} 章失败: ${e.message}（5 秒后重试）`;
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const info = parseChapter(directory, n);
        const r2 = await runChapterPipeline({
          bookId,
          novelNumber: n,
          title: info.title,
          chapterRole: info.chapterRole,
          chapterPurpose: info.chapterPurpose,
          chapterSummary: info.chapterSummary,
          novelSetting: setting.slice(0, 8000),
          setting,
          globalSummary: summary.slice(-16000),
          characterState: characters.slice(-8000),
          previousExcerpt: prevContent ? prevContent.slice(-3000) : undefined,
          wordNumber: project.wordPerChapter || 2000,
          topic: project.topic || '',
          humanizeStrength: 0.85,
          stages: { consistency: true, finalize: true, qualityRepair: true },
        });
        if (!r2.ok) throw new Error(r2.error || '重试失败');
        fs.mkdirSync(chDir(bookId), { recursive: true });
        fs.writeFileSync(path.join(chDir(bookId), `${n}.txt`), r2.content);
        summary = r2.summary || summary;
        characters = r2.characterState || characters;
        prevContent = r2.content;
        project.globalSummary = summary;
        project.characterState = characters;
        project.lastGeneratedChapter = n;
        saveProject(bookId, project);
      } catch (e2) {
        task.message = `第 ${n} 章重试仍失败: ${e2.message}，跳过`;
      }
    }
    n += 1;
    await new Promise((r) => setTimeout(r, 1500));
  }
  task.running = false;
  task.message = task.stopRequested ? `已暂停（第 ${project.lastGeneratedChapter} 章）` : `完成：第 ${project.lastGeneratedChapter} 章`;
  task.finishedAt = new Date().toISOString();
}

/** 启动批量生产 */
bookRouter.post('/batch-generate', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const toChapter = Number(req.body?.toChapter) || 0;
    if (!bookId || !toChapter) return res.status(400).json({ ok: false, error: '缺少 bookId/toChapter' });
    const exist = batchTasks.get(bookId);
    if (exist?.running) return res.json({ ok: true, alreadyRunning: true, task: exist });
    const task = {
      bookId, running: true, current: 0, target: toChapter, message: '启动中…',
      stopRequested: false, startedAt: new Date().toISOString(),
    };
    batchTasks.set(bookId, task);
    runBatch(bookId, toChapter).catch((e) => {
      task.running = false;
      task.message = '任务异常: ' + e.message;
    });
    res.json({ ok: true, task });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 批量生产状态 */
bookRouter.get('/batch-generate/status', (req, res) => {
  try {
    const bookId = safeBookId(String(req.query.bookId || ''));
    const task = bookId ? batchTasks.get(bookId) : null;
    res.json({ ok: true, task: task || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 暂停批量生产 */
bookRouter.post('/batch-generate/stop', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const task = batchTasks.get(bookId);
    if (task) task.stopRequested = true;
    res.json({ ok: true, stopRequested: !!task });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 全书审计（品控看板数据） ========== */
bookRouter.post('/audit', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });
    const dir = chDir(bookId);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort((a, b) => Number(a) - Number(b))
      : [];

    const AI_CHECKS = [
      [/……/g, '省略号'], [/——/g, '破折号'],
      [/不禁|不由|顿时|瞬间/g, 'AI情绪副词'], [/仿佛|宛如|如同|好似/g, 'AI比喻词'],
      [/嘴角|瞳孔|深吸一口气/g, 'AI动作模板'], [/然而|与此同时/g, '转折词癖'],
      [/不是[^。！？\n]{0,20}，?(也)?不是[^。！？\n]{0,20}，?而是/g, '对照句'],
      [/微微|缓缓|渐渐/g, '万能副词'], [/命运|羁绊|深渊|试炼/g, '抽象大词'],
    ];

    const chapters = files.map((f) => {
      const n = Number(f.replace('.txt', ''));
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const chars = text.replace(/\s/g, '').length;
      const { scores, average } = scoreTomatoReadability(text, 2000);
      const issues = collectTomatoLocalIssues(text, 2000);
      const aiHits = [];
      for (const [re, label] of AI_CHECKS) {
        const c = (text.match(re) || []).length;
        if (c > 0) aiHits.push(`${label}×${c}`);
      }
      const sentences = text.split(/[。！？!?]/).filter((s) => s.length > 5);
      const avgLen = sentences.length ? sentences.reduce((a, b) => a + b.length, 0) / sentences.length : 0;
      const problems = [];
      if (chars < 1500) problems.push(`字数偏少(${chars})`);
      if (average < 8.2) problems.push(`番茄分${average}`);
      if (avgLen > 25) problems.push(`句长${avgLen.toFixed(0)}`);
      if (issues.length) problems.push(...issues.slice(0, 2));
      return { n, chars, score: Math.round(average * 10) / 10, avgLen: Math.round(avgLen), aiHits: aiHits.slice(0, 3), problems: problems.slice(0, 4) };
    });

    const totalChars = chapters.reduce((a, c) => a + c.chars, 0);
    const avgScore = chapters.length ? chapters.reduce((a, c) => a + c.score, 0) / chapters.length : 0;
    const dist = { good: 0, ok: 0, weak: 0, bad: 0 };
    for (const c of chapters) {
      if (c.score >= 8.5) dist.good++;
      else if (c.score >= 8.2) dist.ok++;
      else if (c.score >= 7.8) dist.weak++;
      else dist.bad++;
    }
    const problemChapters = chapters.filter((c) => c.problems.length).sort((a, b) => a.score - b.score);
    const abilities = getAbilities(bookId).list || [];
    const foreshadows = getForeshadows(bookId).list || [];

    res.json({
      ok: true,
      summary: {
        chapterCount: chapters.length,
        totalChars,
        avgScore: Math.round(avgScore * 10) / 10,
        dist,
        problemCount: problemChapters.length,
        abilityCount: abilities.length,
        foreshadowCount: foreshadows.length,
        forgottenForeshadows: foreshadows.filter((f) => f.status === 'forgotten').length,
      },
      chapters,
      problemChapters: problemChapters.slice(0, 30),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 番茄推流验证分（满分 60 才可发布） ========== */

/** 单章推流验证分 */
bookRouter.post('/promotion-score', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const chapterNumber = Number(req.body?.chapterNumber);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });
    if (!chapterNumber) {
      // 全书统计
      const project = loadProject(bookId);
      const dir = chDir(bookId);
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort((a, b) => Number(a) - Number(b))
        : [];
      const chapters = files.map((f) => ({
        n: Number(f.replace('.txt', '')),
        text: fs.readFileSync(path.join(dir, f), 'utf8'),
        target: project.wordPerChapter || 2000,
      }));
      const book = scorePromotionBook(chapters);
      return res.json({ ok: true, ...book });
    }
    const f = path.join(chDir(bookId), `${chapterNumber}.txt`);
    if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: `第 ${chapterNumber} 章不存在` });
    const project = loadProject(bookId);
    const text = fs.readFileSync(f, 'utf8');
    const r = scorePromotion(text, project.wordPerChapter || 2000);
    res.json({ ok: true, chapterNumber, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 第三方专业审查（编辑/读者/文笔三审） ========== */
const reviewTasks = new Map(); // bookId -> { running, current, total, message, results }

bookRouter.post('/review', async (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const chapters = (req.body?.chapters || [1, 2, 3]).map(Number).filter(Number.isFinite);
    if (!bookId || !chapters.length) return res.status(400).json({ ok: false, error: '缺少 bookId/chapters' });

    const exist = reviewTasks.get(bookId);
    if (exist?.running) return res.json({ ok: true, alreadyRunning: true, task: exist });

    const task = { bookId, running: true, current: 0, total: chapters.length, message: '启动审查…', results: [], startedAt: new Date().toISOString() };
    reviewTasks.set(bookId, task);

    (async () => {
      const project = loadProject(bookId);
      for (const n of chapters) {
        task.current = n;
        task.message = `第 ${n} 章三方审查中…`;
        const f = path.join(chDir(bookId), `${n}.txt`);
        if (fs.existsSync(f)) {
          try {
            const text = fs.readFileSync(f, 'utf8');
            const meta = (() => {
              const blocks = (project.directory || '').split(/\n\s*\n/);
              const block = blocks.find((b) => b.includes(`第${n}章`)) || '';
              return {
                title: (block.match(/第\d+章\s*-\s*([^\n]+)/) || [])[1]?.trim() || '',
                summary: (block.match(/本章简述[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
                globalSummary: project.globalSummary,
              };
            })();
            const review = await thirdPartyReviewChapter(text, meta);
            task.results.push({ chapterNumber: n, ...review.summary, details: review.results });
          } catch (e) {
            task.results.push({ chapterNumber: n, error: e.message });
          }
        }
      }
      task.running = false;
      task.message = '审查完成';
      task.finishedAt = new Date().toISOString();
    })();

    res.json({ ok: true, task });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

bookRouter.get('/review/status', (req, res) => {
  try {
    const bookId = safeBookId(String(req.query.bookId || ''));
    res.json({ ok: true, task: bookId ? reviewTasks.get(bookId) || null : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 自动修复流水线（审查→补丁修复→本地清洗） ========== */
const repairTasks = new Map();

bookRouter.post('/auto-repair', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const chapters = (req.body?.chapters || [1, 2, 3]).map(Number).filter(Number.isFinite);
    if (!bookId || !chapters.length) return res.status(400).json({ ok: false, error: '缺少 bookId/chapters' });
    const exist = repairTasks.get(bookId);
    if (exist?.running) return res.json({ ok: true, alreadyRunning: true, task: exist });

    const task = { bookId, running: true, current: 0, total: chapters.length, message: '启动修复…', results: [], startedAt: new Date().toISOString() };
    repairTasks.set(bookId, task);

    (async () => {
      const project = loadProject(bookId);
      for (const n of chapters) {
        task.current = n;
        task.message = `第 ${n} 章：三方审查 + 修复中…`;
        const f = path.join(chDir(bookId), `${n}.txt`);
        if (!fs.existsSync(f)) { task.results.push({ chapterNumber: n, error: '章节不存在' }); continue; }
        try {
          const text = fs.readFileSync(f, 'utf8');
          const meta = (() => {
            const blocks = (project.directory || '').split(/\n\s*\n/);
            const block = blocks.find((b) => b.includes(`第${n}章`)) || '';
            return {
              title: (block.match(/第\d+章\s*-\s*([^\n]+)/) || [])[1]?.trim() || '',
              summary: (block.match(/本章简述[：:]\s*([^\n]+)/) || [])[1]?.trim() || '',
              globalSummary: project.globalSummary,
            };
          })();
          const r = await runAutoRepair(text, meta, { targetChars: project.wordPerChapter || 2000 });
          // 有实际修改才写盘（备份原稿）
          const changed = r.finalText !== text;
          if (changed) {
            fs.copyFileSync(f, f + '.prerepair.bak');
            fs.writeFileSync(f, r.finalText);
          }
          task.results.push({
            chapterNumber: n,
            changed,
            patchApplied: r.patch?.applied || 0,
            patchSkipped: r.patch?.skipped || 0,
            metaphor: r.metaphor,
            reviewVerdict: r.review?.summary?.verdict || '未审查',
            reviewAvg: r.review?.summary?.avgScore || null,
          });
        } catch (e) {
          task.results.push({ chapterNumber: n, error: e.message });
        }
      }
      task.running = false;
      task.message = '修复完成';
      task.finishedAt = new Date().toISOString();
    })();

    res.json({ ok: true, task });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

bookRouter.get('/auto-repair/status', (req, res) => {
  try {
    const bookId = safeBookId(String(req.query.bookId || ''));
    res.json({ ok: true, task: bookId ? repairTasks.get(bookId) || null : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 整书打磨（书级审查，全本完成后） ========== */
const polishTasks = new Map();

bookRouter.post('/polish', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });
    const exist = polishTasks.get(bookId);
    if (exist?.running) return res.json({ ok: true, alreadyRunning: true, task: exist });

    const task = { bookId, running: true, message: '整书打磨中…', result: null, startedAt: new Date().toISOString() };
    polishTasks.set(bookId, task);

    (async () => {
      try {
        const project = loadProject(bookId);
        const dir = chDir(bookId);
        const files = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt') && !f.startsWith('_')).sort((a, b) => Number(a) - Number(b))
          : [];
        const chapters = {};
        for (const f of files) chapters[Number(f.replace('.txt', ''))] = fs.readFileSync(path.join(dir, f), 'utf8');
        task.message = `整书打磨中（${files.length} 章抽样审查）…`;
        const result = await runBookPolish({
          bookId,
          project,
          chapters,
          total: files.length,
          directorOutline: project.directorOutline || '',
        });
        task.result = result;
        task.message = result.ok ? '整书打磨完成' : '打磨失败';
      } catch (e) {
        task.result = { ok: false, error: e.message };
        task.message = '打磨异常';
      } finally {
        task.running = false;
        task.finishedAt = new Date().toISOString();
      }
    })();

    res.json({ ok: true, task });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

bookRouter.get('/polish/status', (req, res) => {
  try {
    const bookId = safeBookId(String(req.query.bookId || ''));
    res.json({ ok: true, task: bookId ? polishTasks.get(bookId) || null : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== AI 味指数逐句定位（本地，0 token） ========== */
bookRouter.post('/ai-index', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const chapterNumber = Number(req.body?.chapterNumber);
    if (!bookId || !chapterNumber) return res.status(400).json({ ok: false, error: '缺少 bookId/chapterNumber' });
    const f = path.join(chDir(bookId), `${chapterNumber}.txt`);
    if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: `第 ${chapterNumber} 章不存在` });
    const text = fs.readFileSync(f, 'utf8');
    const result = locateAiFlavor(text);
    res.json({ ok: true, chapterNumber, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 商业化三件套（书名/简介/标签） ========== */
bookRouter.post('/commercial-pack', async (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });
    const project = loadProject(bookId);
    // 黄金三章拼接（前 3 章开头）
    let goldenChapters = '';
    for (const n of [1, 2, 3]) {
      const f = path.join(chDir(bookId), `${n}.txt`);
      if (fs.existsSync(f)) goldenChapters += `【第${n}章】${fs.readFileSync(f, 'utf8').slice(0, 800)}\n\n`;
    }
    const result = await runCommercialPack({
      topic: project.topic || '',
      genre: project.genre || '',
      setting: project.setting || '',
      goldenChapters,
      existingTitle: project.topic?.split('\n')[0]?.slice(0, 20) || '',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 章节版本回滚（草稿箱） ========== */
bookRouter.get('/chapter-history', (req, res) => {
  try {
    const bookId = safeBookId(String(req.query.bookId || ''));
    const chapterNumber = Number(req.query.chapterNumber);
    if (!bookId || !chapterNumber) return res.status(400).json({ ok: false, error: '缺少 bookId/chapterNumber' });
    res.json({ ok: true, versions: listChapterHistory(bookId, chapterNumber) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

bookRouter.post('/chapter-restore', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const chapterNumber = Number(req.body?.chapterNumber);
    const version = String(req.body?.version || '');
    if (!bookId || !chapterNumber || !version) return res.status(400).json({ ok: false, error: '缺少参数' });
    const result = restoreChapterFile(bookId, chapterNumber, version);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 番茄作家后台数据看板 ========== */
bookRouter.get('/fanqie-data', (req, res) => {
  try {
    res.json({ ok: true, cached: getCachedFanqieData(), loggedIn: hasFanqieLogin() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

bookRouter.post('/fanqie-data/refresh', async (req, res) => {
  try {
    const result = await fetchFanqieData();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
