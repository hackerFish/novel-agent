/**
 * 试产单章：调用当前配置的 LLM 生成一章，结果写入 .codex-run/，不修改书籍数据。
 * 用法：node server/scripts/test_one_chapter.mjs [章节号，默认 1]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDirectory, getChapterInfo } from '../src/writer/directoryParser.js';
import { generateChapter } from '../src/writer/generator.js';
import { getConfig } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '.t-book-books');
const INDEX_PATH = path.join(BOOKS_DIR, 'index.json');
const OUT_DIR = path.join(__dirname, '..', '..', '.codex-run');

const chapterNumber = parseInt(process.argv[2] || '1', 10);

function loadCurrentBook() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const bookId = index.currentBookId;
  const bookPath = path.join(BOOKS_DIR, `${bookId}.json`);
  const project = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
  return { bookId, project };
}

function buildOpts(project, parsed, n) {
  const info = getChapterInfo(parsed, n);
  const next = getChapterInfo(parsed, n + 1);
  const outlineWindow = parsed
    .filter((c) => c.number >= n - 3 && c.number <= n + 3)
    .map((c) => `第${c.number}章 ${c.title}：${c.summary || c.purpose || ''}`)
    .join('\n');
  const drafts = project.draftedChapters || {};

  return {
    chapterNumber: n,
    title: info.title || `第${n}章`,
    chapterRole: info.role || '',
    chapterPurpose: info.purpose || '',
    chapterSummary: info.summary || '',
    novelSetting: (project.setting || '').slice(0, 4000),
    globalSummary: n === 1 ? undefined : (project.globalSummary || '').slice(-8000),
    previousExcerpt: n > 1 && drafts[n - 1] ? String(drafts[n - 1]).slice(-2000) : undefined,
    characterState: project.characterState ? String(project.characterState).slice(-4000) : undefined,
    outlineWindow: outlineWindow || undefined,
    nextChapterTitle: next?.title,
    nextChapterSummary: next?.summary,
    wordNumber: project.wordPerChapter || 2000,
    topic: project.topic || '',
    voiceCard: project.voiceCard || '',
    userGuidance: '【试产】测试口吻卡与番茄润稿，保持林照摆烂人味。',
  };
}

async function main() {
  const cfg = getConfig();
  console.log(`模型: ${cfg.openaiModel || cfg.ollamaModel} (${cfg.provider})`);
  console.log(`试产第 ${chapterNumber} 章…`);

  const { bookId, project } = loadCurrentBook();
  const parsed = parseDirectory(project.directory || '');
  const opts = buildOpts(project, parsed, chapterNumber);

  const started = Date.now();
  const result = await generateChapter(opts, 0.7);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const text = result.content || '';
  const charCount = text.replace(/\s/g, '').length;
  const modelSlug = (cfg.openaiModel || cfg.ollamaModel || 'model').replace(/[/\\:]/g, '-');

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(
    OUT_DIR,
    `test-chapter-${modelSlug}-ch${chapterNumber}-${Date.now()}.txt`
  );
  const header = [
    `# 试产章节（不写入书籍）`,
    `book: ${bookId}`,
    `chapter: ${chapterNumber} ${opts.title}`,
    `model: ${cfg.provider} / ${cfg.openaiModel || cfg.ollamaModel}`,
    `chars: ${charCount} (target ~${opts.wordNumber})`,
    `elapsed: ${elapsed}s`,
    `quality: ${JSON.stringify(result.quality || {})}`,
    '',
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(outPath, header + text, 'utf8');

  console.log(`完成：${charCount} 字，耗时 ${elapsed}s`);
  console.log(`输出：${outPath}`);
  console.log('\n--- 正文预览（前 800 字）---\n');
  console.log(text.slice(0, 800));
}

main().catch((e) => {
  console.error('试产失败:', e.message);
  process.exit(1);
});
