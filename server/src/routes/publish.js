import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { parseDirectory } from '../writer/directoryParser.js';
import { hydrateDraftedChapters } from '../storage/chapterStorage.js';
import {
  buildPublishSchedule,
  buildChapterTitle,
  countContentChars,
  normalizePublishConfig,
} from '../publish/schedule.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '..', '.t-book-books');

function safeBookId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function loadBookProject(bookId) {
  const id = safeBookId(bookId);
  if (!id) throw new Error('无效 bookId');
  const filePath = path.join(BOOKS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) throw new Error('书籍不存在');
  const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  project.draftedChapters = hydrateDraftedChapters(id, project.draftedChapters || {});
  return project;
}

function inferBookTitle(project) {
  const topic = String(project?.topic || '').trim();
  if (topic) return topic.split('\n')[0].slice(0, 40);
  return '未命名作品';
}

function qualityLabel(content) {
  const text = String(content || '').trim();
  if (!text) return '不可用';
  const words = countContentChars(text);
  if (words < 1800) return '偏短';
  if (/本章定位|核心作用|AI生成/.test(text)) return '有残留';
  return '可发布';
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildReadme(config, count) {
  return `番茄小说 · 批量发布包说明
================================

本包共 ${count} 章，按排程表建议时间定时发布。

【推荐流程】
1. 解压本 ZIP，打开 publish-schedule.csv（可用 Excel 打开）
2. 登录番茄小说作家后台 → 作品管理 → 章节管理
3. 对每一行待发布章节：
   - 点击「新建章节」或「定时发布」
   - 标题：复制 CSV 中「标题」列，或打开 chapters 文件夹中对应 txt 的第一行
   - 正文：复制 txt 文件中标题以下的内容（不要带标题行）
   - 定时：按 CSV「建议发布时间」设置

【更快方式】
在本项目 Step5 使用「连续发布助手」：
逐章自动复制标题/正文，你在番茄后台粘贴即可，比翻文件夹更快。

【排程参数】
- 起始日期：${config.startDate}
- 每日章数：${config.chaptersPerDay}
- 发布时段：${config.timeSlots.join('、')}

【注意】
- 番茄暂无公开批量上传 API，最后粘贴步骤需人工完成
- 发布前请检查质检列；「不可用/有残留」的章先回 Step3 修稿
`;
}

export const publishRouter = Router();

/** 预览排程（JSON） */
publishRouter.post('/schedule', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId || req.query?.bookId);
    const project = loadBookProject(bookId);
    const config = normalizePublishConfig({ ...project.publishConfig, ...req.body?.config });
    const parsed = parseDirectory(project.directory || '');
    const chapterMap = new Map(parsed.map((c) => [c.number, c]));
    const publishStates = project.publishStates || {};

    let numbers = Object.keys(project.draftedChapters || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .filter((n) => n >= config.startChapter);

    if (config.onlyUnpublished) {
      numbers = numbers.filter((n) => !['published', 'approved'].includes(publishStates[n]?.status || 'draft'));
    }

    const schedule = buildPublishSchedule({
      chapterNumbers: numbers,
      startDate: config.startDate,
      chaptersPerDay: config.chaptersPerDay,
      timeSlots: config.timeSlots,
    });

    const rows = schedule.map((row) => ({
      ...row,
      title: buildChapterTitle(chapterMap.get(row.chapterNumber), row.chapterNumber),
      wordCount: countContentChars(project.draftedChapters[row.chapterNumber]),
      quality: qualityLabel(project.draftedChapters[row.chapterNumber]),
      status: publishStates[row.chapterNumber]?.status || 'draft',
    }));

    res.json({ ok: true, config, total: rows.length, schedule: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 批量导出 ZIP：分章 txt + 排程 CSV + 说明 */
publishRouter.post('/batch-export', async (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId || req.query?.bookId);
    const project = loadBookProject(bookId);
    const config = normalizePublishConfig({ ...project.publishConfig, ...req.body?.config });
    const parsed = parseDirectory(project.directory || '');
    const chapterMap = new Map(parsed.map((c) => [c.number, c]));
    const publishStates = project.publishStates || {};
    const bookTitle = inferBookTitle(project);

    let numbers = Object.keys(project.draftedChapters || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .filter((n) => n >= config.startChapter);

    if (req.body?.toChapter) {
      numbers = numbers.filter((n) => n <= Number(req.body.toChapter));
    }

    if (config.onlyUnpublished) {
      numbers = numbers.filter((n) => !['published', 'approved'].includes(publishStates[n]?.status || 'draft'));
    }

    if (!numbers.length) {
      return res.status(400).json({ ok: false, error: '没有可导出的章节（请检查是否已全部标记为已发布）' });
    }

    const schedule = buildPublishSchedule({
      chapterNumbers: numbers,
      startDate: config.startDate,
      chaptersPerDay: config.chaptersPerDay,
      timeSlots: config.timeSlots,
    });

    const scheduleMap = new Map(schedule.map((s) => [s.chapterNumber, s]));
    const stamp = new Date().toISOString().slice(0, 10);
    const zipName = `${bookTitle}_番茄发布包_${numbers[0]}-${numbers[numbers.length - 1]}章_${stamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
    });
    archive.pipe(res);

    const csvLines = ['章节号,标题,建议发布时间,字数,质检,发布状态'];
    for (const n of numbers) {
      const title = buildChapterTitle(chapterMap.get(n), n);
      const content = String(project.draftedChapters[n] || '').trim();
      const words = countContentChars(content);
      const quality = qualityLabel(content);
      const status = publishStates[n]?.status || 'draft';
      const sched = scheduleMap.get(n);
      const fileName = `chapters/${String(n).padStart(3, '0')}_${title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
      archive.append(`${title}\n\n${content}`, { name: fileName });
      csvLines.push([
        n,
        escapeCsv(title),
        escapeCsv(sched?.scheduledAt || ''),
        words,
        escapeCsv(quality),
        escapeCsv(status),
      ].join(','));
    }

    archive.append(csvLines.join('\n'), { name: 'publish-schedule.csv' });
    archive.append(buildReadme(config, numbers.length), { name: 'README_番茄发布说明.txt' });

    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
  }
});

/** 批量写入排程到 publishStates（scheduledAt 字段） */
publishRouter.post('/apply-schedule', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });

    const filePath = path.join(BOOKS_DIR, `${bookId}.json`);
    const project = loadBookProject(bookId);
    const config = normalizePublishConfig({ ...project.publishConfig, ...req.body?.config });
    project.publishConfig = config;

    const parsed = parseDirectory(project.directory || '');
    const chapterMap = new Map(parsed.map((c) => [c.number, c]));
    const publishStates = { ...(project.publishStates || {}) };

    let numbers = Object.keys(project.draftedChapters || {})
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .filter((n) => n >= config.startChapter);

    if (config.onlyUnpublished) {
      numbers = numbers.filter((n) => !['published', 'approved'].includes(publishStates[n]?.status || 'draft'));
    }

    const schedule = buildPublishSchedule({
      chapterNumbers: numbers,
      startDate: config.startDate,
      chaptersPerDay: config.chaptersPerDay,
      timeSlots: config.timeSlots,
    });

    for (const row of schedule) {
      const prev = publishStates[row.chapterNumber] || { status: 'draft' };
      publishStates[row.chapterNumber] = {
        ...prev,
        scheduledAt: row.scheduledAt,
        note: `建议 ${row.scheduledAt} 发布 · ${buildChapterTitle(chapterMap.get(row.chapterNumber), row.chapterNumber)}`,
      };
    }

    project.publishStates = publishStates;
    fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');

    res.json({ ok: true, applied: schedule.length, publishStates, publishConfig: config });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========== 自动发布（Playwright 浏览器自动化） ========== */

/** 自动发布状态 */
publishRouter.get('/auto/status', (req, res) => {
  try {
    const { getStatus } = require('../publish/autoPublish.js');
    res.json({ ok: true, ...getStatus() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 登录引导：弹出浏览器让用户手动登录一次，登录态自动保存 */
publishRouter.post('/auto/login', async (req, res) => {
  try {
    const { ensureLogin } = await import('../publish/autoPublish.js');
    const timeoutMs = Number(req.body?.timeoutMs) || 300000;
    const result = await ensureLogin({ timeoutMs });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 立即发布一章：{ bookId, chapterNumber, scheduleMinutes } */
publishRouter.post('/auto/publish', async (req, res) => {
  try {
    const { publishChapter } = await import('../publish/autoPublish.js');
    const { bookId, chapterNumber, scheduleMinutes } = req.body || {};
    if (!bookId || !chapterNumber) return res.status(400).json({ ok: false, error: '缺少 bookId/chapterNumber' });
    const project = loadBookProject(bookId);
    const chapters = hydrateDraftedChapters(bookId, project.draftedChapters || {});
    const content = chapters[chapterNumber];
    if (!content) return res.status(404).json({ ok: false, error: `第 ${chapterNumber} 章不存在` });

    // 推流验证分门槛：满分才可发布
    const { scorePromotion } = await import('../writer/promotionScore.js');
    const promo = scorePromotion(content, project.wordPerChapter || 2000);
    if (!promo.ok) {
      return res.status(422).json({
        ok: false,
        error: `推流验证分未达满分（${promo.total}/${promo.max}），禁止发布。修复项：${promo.fixHints.slice(0, 4).join('；')}`,
        promotion: promo,
      });
    }

    const parsed = parseDirectory(project.directory || '');
    const info = parsed.find((c) => c.number === Number(chapterNumber));
    const title = info?.title ? `第${chapterNumber}章 ${info.title}` : `第${chapterNumber}章`;

    const result = await publishChapter({ title, content, scheduleMinutes: Number(scheduleMinutes) || 0 });

    // 标记已发布
    const publishStates = { ...(project.publishStates || {}) };
    publishStates[chapterNumber] = { status: 'published', publishedAt: result.publishedAt, note: '自动发布' };
    project.publishStates = publishStates;
    fs.writeFileSync(path.join(BOOKS_DIR, `${bookId}.json`), JSON.stringify(project, null, 2), 'utf8');

    res.json({ ok: true, ...result, chapterNumber, promotion: { total: promo.total, max: promo.max } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 启动排程调度（按 publishStates.scheduledAt 到点自动发布） */
publishRouter.post('/auto/scheduler/start', (req, res) => {
  try {
    const { startScheduler } = require('../publish/autoPublish.js');
    const { bookId } = req.body || {};
    const queue = [];
    if (bookId && safeBookId(bookId)) {
      try {
        const project = loadBookProject(bookId);
        const chapters = hydrateDraftedChapters(bookId, project.draftedChapters || {});
        const parsed = parseDirectory(project.directory || '');
        for (const [num, content] of Object.entries(chapters)) {
          const n = Number(num);
          const st = project.publishStates?.[n] || {};
          if (st.scheduledAt && !['published', 'approved'].includes(st.status || '')) {
            const info = parsed.find((c) => c.number === n);
            queue.push({ chapterNumber: n, title: info?.title ? `第${n}章 ${info.title}` : `第${n}章`, content, scheduledAt: st.scheduledAt });
          }
        }
      } catch { /* 队列为空也能启动 */ }
    }
    const result = startScheduler(() => queue);
    res.json({ ok: true, ...result, queued: queue.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 停止调度 */
publishRouter.post('/auto/scheduler/stop', (req, res) => {
  try {
    const { stopScheduler } = require('../publish/autoPublish.js');
    res.json({ ok: true, ...stopScheduler() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
