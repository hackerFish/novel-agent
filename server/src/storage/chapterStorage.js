import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '..', '.t-book-books');

export function getChaptersDir(bookId) {
  return path.join(BOOKS_DIR, 'chapters', bookId);
}

export function saveChapterFile(bookId, chapterNumber, text) {
  const n = Number(chapterNumber);
  if (!Number.isFinite(n) || n < 1) return;
  const dir = getChaptersDir(bookId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${n}.txt`), String(text || ''), 'utf8');
}

export function loadChapterFile(bookId, chapterNumber) {
  const filePath = path.join(getChaptersDir(bookId), `${chapterNumber}.txt`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

/** 将 JSON 内章节迁移到独立文件，返回瘦身后的 draftedChapters 占位 */
export function migrateDraftedChaptersToFiles(bookId, draftedChapters = {}) {
  const entries = Object.entries(draftedChapters || {}).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) return draftedChapters;

  for (const [key, value] of entries) {
    const n = parseInt(key, 10);
    if (Number.isFinite(n)) saveChapterFile(bookId, n, value);
  }
  return { _storage: 'external' };
}

/** 加载项目时合并外部章节文件 */
export function hydrateDraftedChapters(bookId, draftedChapters = {}) {
  const dir = getChaptersDir(bookId);
  const merged = {};

  if (draftedChapters && draftedChapters._storage !== 'external') {
    Object.assign(merged, draftedChapters);
  }

  if (!fs.existsSync(dir)) return merged;

  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^(\d+)\.txt$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    merged[n] = fs.readFileSync(path.join(dir, file), 'utf8');
  }
  return merged;
}
