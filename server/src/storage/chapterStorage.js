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
  const filePath = path.join(dir, `${n}.txt`);
  // 版本回滚：保存前保留旧版（最近 MAX_HISTORY 版）
  if (fs.existsSync(filePath)) {
    try {
      const historyDir = path.join(dir, '_history', `ch${n}`);
      fs.mkdirSync(historyDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(filePath, path.join(historyDir, `${stamp}.txt`));
      // 裁剪超过 5 版
      const versions = fs.readdirSync(historyDir).sort();
      while (versions.length > MAX_HISTORY) {
        fs.unlinkSync(path.join(historyDir, versions.shift()));
      }
    } catch { /* 历史记录失败不影响保存 */ }
  }
  fs.writeFileSync(filePath, String(text || ''), 'utf8');
}

const MAX_HISTORY = 5;

/** 列出章节历史版本 */
export function listChapterHistory(bookId, chapterNumber) {
  const historyDir = path.join(getChaptersDir(bookId), '_history', `ch${chapterNumber}`);
  if (!fs.existsSync(historyDir)) return [];
  return fs
    .readdirSync(historyDir)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .reverse()
    .map((f) => {
      const full = path.join(historyDir, f);
      const stat = fs.statSync(full);
      return {
        version: f.replace('.txt', ''),
        savedAt: stat.mtime.toISOString(),
        chars: fs.readFileSync(full, 'utf8').replace(/\s/g, '').length,
      };
    });
}

/** 回滚章节到指定历史版本 */
export function restoreChapterFile(bookId, chapterNumber, version) {
  const historyDir = path.join(getChaptersDir(bookId), '_history', `ch${chapterNumber}`);
  const file = path.join(historyDir, `${version}.txt`);
  if (!fs.existsSync(file)) return { ok: false, error: '版本不存在' };
  const content = fs.readFileSync(file, 'utf8');
  saveChapterFile(bookId, chapterNumber, content);
  return { ok: true, chars: content.replace(/\s/g, '').length };
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
