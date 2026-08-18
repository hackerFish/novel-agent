import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  hydrateDraftedChapters,
  migrateDraftedChaptersToFiles,
  saveChapterFile,
} from '../storage/chapterStorage.js';
import { LINZHAO_VOICE_CARD, detectLinZhaoBook } from '../writer/voiceCard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_PROJECT_PATH = path.join(__dirname, '..', '..', '.t-book-project.json');
const BOOKS_DIR = path.join(__dirname, '..', '..', '.t-book-books');
const INDEX_PATH = path.join(BOOKS_DIR, 'index.json');

const defaultProject = {
  topic: '',
  genre: '都市',
  wordPerChapter: 2000,
  setting: '',
  numChapters: 20,
  directory: '',
  globalSummary: '',
  characterState: '',
  draftedChapters: {},
  publishStates: {},
  lastGeneratedChapter: 0,
  voiceCard: '',
};

function ensureBooksDir() {
  if (!fs.existsSync(BOOKS_DIR)) fs.mkdirSync(BOOKS_DIR, { recursive: true });
}

function createId() {
  return `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeBookId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function getBookPath(bookId) {
  const id = safeBookId(bookId);
  if (!id) throw new Error('Invalid bookId');
  return path.join(BOOKS_DIR, `${id}.json`);
}

function inferTitle(project, fallback = '未命名作品') {
  const topic = String(project?.topic || '').trim();
  if (topic) return topic.split('\n')[0].slice(0, 40);
  const setting = String(project?.setting || '');
  const titleMatch = setting.match(/(?:书名|作品名)[:：]\s*《?([^》\n]+)》?/);
  if (titleMatch?.[1]) return titleMatch[1].trim().slice(0, 40);
  return fallback;
}

function normalizeProject(data = {}) {
  return {
    topic: data.topic ?? '',
    genre: data.genre ?? '都市',
    wordPerChapter: data.wordPerChapter ?? 2000,
    setting: data.setting ?? '',
    numChapters: data.numChapters ?? 20,
    directory: data.directory ?? '',
    globalSummary: data.globalSummary ?? '',
    characterState: data.characterState ?? '',
    draftedChapters: data.draftedChapters ?? {},
    publishStates: data.publishStates ?? {},
    lastGeneratedChapter: data.lastGeneratedChapter ?? 0,
    voiceCard: data.voiceCard ?? '',
    publishConfig: data.publishConfig ?? undefined,
  };
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadIndex() {
  ensureBooksDir();
  const index = readJson(INDEX_PATH, { currentBookId: '', books: [] });
  if (!Array.isArray(index.books)) index.books = [];
  return index;
}

function saveIndex(index) {
  ensureBooksDir();
  writeJson(INDEX_PATH, {
    currentBookId: index.currentBookId || '',
    books: index.books || [],
  });
}

function migrateLegacyProjectIfNeeded() {
  ensureBooksDir();
  const index = loadIndex();
  if (index.books.length > 0) return index;

  const legacyProject = readJson(LEGACY_PROJECT_PATH, null);
  const now = new Date().toISOString();
  const id = createId();
  const project = normalizeProject(legacyProject || defaultProject);
  const meta = {
    id,
    title: inferTitle(project, legacyProject ? '旧项目迁移' : '我的第一本书'),
    createdAt: now,
    updatedAt: now,
    topic: project.topic || '',
    numChapters: project.numChapters || 20,
    lastGeneratedChapter: project.lastGeneratedChapter || 0,
  };

  writeJson(getBookPath(id), project);
  const nextIndex = { currentBookId: id, books: [meta] };
  saveIndex(nextIndex);
  return nextIndex;
}

function getCurrentBookId(req) {
  const queryId = safeBookId(req.query.bookId);
  if (queryId) return queryId;
  const index = migrateLegacyProjectIfNeeded();
  return index.currentBookId || index.books[0]?.id || '';
}

function loadProject(bookId) {
  const id = safeBookId(bookId);
  if (!id) return { ...defaultProject };
  const raw = normalizeProject(readJson(getBookPath(id), defaultProject));
  raw.draftedChapters = hydrateDraftedChapters(id, raw.draftedChapters);
  if (!raw.voiceCard && detectLinZhaoBook(raw.topic, raw.setting)) {
    raw.voiceCard = LINZHAO_VOICE_CARD;
  }
  return raw;
}

function maybePersistAutoVoiceCard(bookId, project) {
  const path = getBookPath(bookId);
  const stored = normalizeProject(readJson(path, defaultProject));
  if (stored.voiceCard?.trim()) return;
  if (!project.voiceCard?.trim()) return;
  writeJson(path, { ...stored, voiceCard: project.voiceCard });
}

function upsertBookMeta(bookId, project, patch = {}) {
  const index = migrateLegacyProjectIfNeeded();
  const now = new Date().toISOString();
  const existing = index.books.find((book) => book.id === bookId);
  const meta = {
    id: bookId,
    title: patch.title || existing?.title || inferTitle(project),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    topic: project.topic || '',
    numChapters: project.numChapters || 20,
    lastGeneratedChapter: project.lastGeneratedChapter || 0,
  };

  const books = existing
    ? index.books.map((book) => (book.id === bookId ? meta : book))
    : [meta, ...index.books];

  saveIndex({ ...index, currentBookId: bookId, books });
  return meta;
}

function saveProject(bookId, data) {
  ensureBooksDir();
  const id = safeBookId(bookId) || createId();
  const out = normalizeProject(data);
  const chapterCount = Object.keys(out.draftedChapters || {}).filter((k) => /^\d+$/.test(k)).length;
  if (chapterCount > 30 || out.draftedChapters?._storage === 'external') {
    out.draftedChapters = migrateDraftedChaptersToFiles(id, out.draftedChapters);
  }
  writeJson(getBookPath(id), out);
  const meta = upsertBookMeta(id, out);
  return { project: { ...out, draftedChapters: hydrateDraftedChapters(id, out.draftedChapters) }, meta };
}

export const projectRouter = Router();

projectRouter.get('/books', (req, res) => {
  try {
    const index = migrateLegacyProjectIfNeeded();
    res.json(index);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

projectRouter.post('/books', (req, res) => {
  try {
    const index = migrateLegacyProjectIfNeeded();
    const now = new Date().toISOString();
    const id = createId();
    const project = normalizeProject({
      ...defaultProject,
      topic: req.body?.title || '',
      numChapters: req.body?.numChapters || defaultProject.numChapters,
    });
    const meta = {
      id,
      title: String(req.body?.title || '新书').trim() || '新书',
      createdAt: now,
      updatedAt: now,
      topic: project.topic,
      numChapters: project.numChapters,
      lastGeneratedChapter: 0,
    };

    writeJson(getBookPath(id), project);
    saveIndex({ currentBookId: id, books: [meta, ...index.books] });
    res.json({ ok: true, book: meta, currentBookId: id, project });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

projectRouter.delete('/books/:bookId', (req, res) => {
  try {
    const bookId = safeBookId(req.params.bookId);
    const index = migrateLegacyProjectIfNeeded();
    const target = index.books.find((book) => book.id === bookId);
    if (!bookId || !target) {
      return res.status(404).json({ ok: false, error: '书籍不存在' });
    }

    const bookPath = getBookPath(bookId);
    if (fs.existsSync(bookPath)) fs.unlinkSync(bookPath);

    const remainingBooks = index.books.filter((book) => book.id !== bookId);
    let currentBookId = index.currentBookId === bookId
      ? remainingBooks[0]?.id || ''
      : index.currentBookId;
    let books = remainingBooks;

    if (books.length === 0) {
      const now = new Date().toISOString();
      const id = createId();
      const project = normalizeProject(defaultProject);
      const meta = {
        id,
        title: '新书',
        createdAt: now,
        updatedAt: now,
        topic: '',
        numChapters: project.numChapters,
        lastGeneratedChapter: 0,
      };
      writeJson(getBookPath(id), project);
      books = [meta];
      currentBookId = id;
    }

    saveIndex({ currentBookId, books });
    res.json({ ok: true, currentBookId, books });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

projectRouter.post('/current', (req, res) => {
  try {
    const bookId = safeBookId(req.body?.bookId);
    const index = migrateLegacyProjectIfNeeded();
    if (!bookId || !index.books.some((book) => book.id === bookId)) {
      return res.status(404).json({ ok: false, error: '书籍不存在' });
    }
    saveIndex({ ...index, currentBookId: bookId });
    res.json({ ok: true, currentBookId: bookId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

projectRouter.get('/', (req, res) => {
  try {
    const bookId = getCurrentBookId(req);
    const project = loadProject(bookId);
    maybePersistAutoVoiceCard(bookId, project);
    res.json({ ...project, bookId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

projectRouter.post('/', (req, res) => {
  try {
    const bookId = safeBookId(req.query.bookId) || getCurrentBookId(req) || createId();
    const saved = saveProject(bookId, req.body || {});
    res.json({ ok: true, bookId, project: saved.project, book: saved.meta });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** 增量保存单章（正文存独立文件，避免全量 POST 大 JSON） */
projectRouter.post('/chapter', (req, res) => {
  try {
    const bookId = safeBookId(req.query.bookId) || getCurrentBookId(req);
    if (!bookId) return res.status(400).json({ ok: false, error: '缺少 bookId' });

    const chapterNumber = Number(req.body?.chapterNumber);
    const content = req.body?.content;
    if (!Number.isFinite(chapterNumber) || chapterNumber < 1) {
      return res.status(400).json({ ok: false, error: '无效章节号' });
    }
    if (typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: '缺少章节正文' });
    }

    saveChapterFile(bookId, chapterNumber, content);
    const project = loadProject(bookId);
    if (req.body?.globalSummary !== undefined) project.globalSummary = req.body.globalSummary;
    if (req.body?.characterState !== undefined) project.characterState = req.body.characterState;
    if (req.body?.lastGeneratedChapter !== undefined) {
      project.lastGeneratedChapter = req.body.lastGeneratedChapter;
    }
    project.draftedChapters = migrateDraftedChaptersToFiles(bookId, project.draftedChapters);
    writeJson(getBookPath(bookId), project);
    const meta = upsertBookMeta(bookId, project);

    res.json({
      ok: true,
      bookId,
      chapterNumber,
      lastGeneratedChapter: project.lastGeneratedChapter,
      book: meta,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
