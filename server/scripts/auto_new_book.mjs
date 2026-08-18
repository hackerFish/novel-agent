/**
 * 新书全自动：Step1 设定 → Step2 目录（分段）→ Step3+4 逐章 pipeline → 持久化
 *
 * 用法：
 *   node server/scripts/auto_new_book.mjs
 *   node server/scripts/auto_new_book.mjs --spec server/scripts/new-book-spec.json
 *   node server/scripts/auto_new_book.mjs --book-id book_xxx --from 1 --to 10
 *   node server/scripts/auto_new_book.mjs --skip-setting --skip-directory
 *   node server/scripts/auto_new_book.mjs --force   # 覆盖已有章节
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSetting, generateDirectory, generateDirectoryFix, validateDirectory } from '../src/writer/generator.js';
import { runChapterPipeline } from '../src/writer/chapterPipeline.js';
import { parseDirectory, getChapterInfo } from '../src/writer/directoryParser.js';
import { saveChapterFile, migrateDraftedChaptersToFiles } from '../src/storage/chapterStorage.js';
import { getConfig } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKS_DIR = path.join(__dirname, '..', '.t-book-books');
const INDEX_PATH = path.join(BOOKS_DIR, 'index.json');
const LOG_DIR = path.join(__dirname, '..', '..', '.codex-run');
const DEFAULT_SPEC = path.join(__dirname, 'new-book-spec.json');

function parseArgs(argv) {
  const args = {
    spec: DEFAULT_SPEC,
    bookId: '',
    from: 1,
    to: 0,
    skipSetting: false,
    skipDirectory: false,
    force: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--spec' && argv[i + 1]) { args.spec = argv[++i]; continue; }
    if (a === '--book-id' && argv[i + 1]) { args.bookId = argv[++i]; continue; }
    if (a === '--from' && argv[i + 1]) { args.from = parseInt(argv[++i], 10); continue; }
    if (a === '--to' && argv[i + 1]) { args.to = parseInt(argv[++i], 10); continue; }
    if (a === '--skip-setting') { args.skipSetting = true; continue; }
    if (a === '--skip-directory') { args.skipDirectory = true; continue; }
    if (a === '--force') { args.force = true; continue; }
  }
  return args;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'auto-book.log'), `${line}\n`, 'utf8');
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createId() {
  return `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getBookPath(bookId) {
  return path.join(BOOKS_DIR, `${bookId}.json`);
}

function loadSpec(specPath) {
  const raw = readJson(specPath);
  if (!raw?.topic && !raw?.title) {
    throw new Error(`无效 spec：${specPath}`);
  }
  return {
    title: raw.title || raw.topic.split('\n')[0].slice(0, 40),
    topic: raw.topic || raw.title,
    genre: raw.genre || '悬疑',
    numChapters: raw.numChapters || 150,
    wordPerChapter: raw.wordPerChapter || 2200,
    humanizeStrength: typeof raw.humanizeStrength === 'number' ? raw.humanizeStrength : 0.6,
    voiceCard: raw.voiceCard || '',
    publishConfig: raw.publishConfig || undefined,
  };
}

function createBook(spec) {
  const index = readJson(INDEX_PATH, { currentBookId: '', books: [] });
  const id = createId();
  const now = new Date().toISOString();
  const project = {
    topic: spec.topic,
    genre: spec.genre,
    wordPerChapter: spec.wordPerChapter,
    setting: '',
    numChapters: spec.numChapters,
    directory: '',
    globalSummary: '',
    characterState: '',
    draftedChapters: {},
    publishStates: {},
    lastGeneratedChapter: 0,
    voiceCard: spec.voiceCard,
    publishConfig: spec.publishConfig,
  };
  const meta = {
    id,
    title: spec.title,
    createdAt: now,
    updatedAt: now,
    topic: spec.topic,
    numChapters: spec.numChapters,
    lastGeneratedChapter: 0,
  };
  writeJson(getBookPath(id), project);
  writeJson(INDEX_PATH, {
    currentBookId: id,
    books: [meta, ...(index.books || [])],
  });
  log(`创建新书 ${spec.title} (${id})`);
  return { bookId: id, project, meta };
}

function loadBook(bookId) {
  const project = readJson(getBookPath(bookId));
  if (!project) throw new Error(`书籍不存在：${bookId}`);
  const index = readJson(INDEX_PATH, { books: [] });
  const meta = (index.books || []).find((b) => b.id === bookId);
  return { bookId, project, meta };
}

function saveProject(bookId, project) {
  const index = readJson(INDEX_PATH, { books: [] });
  const now = new Date().toISOString();
  project.draftedChapters = migrateDraftedChaptersToFiles(bookId, project.draftedChapters);
  writeJson(getBookPath(bookId), project);
  const books = (index.books || []).map((b) =>
    b.id === bookId
      ? {
          ...b,
          title: b.title || project.topic?.split('\n')[0]?.slice(0, 40) || '新书',
          topic: project.topic,
          numChapters: project.numChapters,
          lastGeneratedChapter: project.lastGeneratedChapter || 0,
          updatedAt: now,
        }
      : b
  );
  writeJson(INDEX_PATH, { ...index, currentBookId: bookId, books });
}

async function generateValidatedDirectorySegment(novelSetting, numChapters, options) {
  const INTERNAL_CHUNK_SIZE = 5;
  const segments = [];
  let rollingSummary = options.previousVolumeSummary || '';

  for (let start = options.volumeStart; start <= options.volumeEnd; start += INTERNAL_CHUNK_SIZE) {
    const end = Math.min(start + INTERNAL_CHUNK_SIZE - 1, options.volumeEnd);
    let result = await generateDirectory(novelSetting, numChapters, {
      volumeStart: start,
      volumeEnd: end,
      previousVolumeSummary: rollingSummary || undefined,
    });
    let directory = result.content || '';
    let validation = validateDirectory(directory, start, end);
    let fixAttempts = 0;
    while (!validation.ok && validation.errors.length > 0 && fixAttempts < 2) {
      fixAttempts += 1;
      const fixResult = await generateDirectoryFix(validation.errors, directory, start, end);
      directory = fixResult.content || directory;
      validation = validateDirectory(directory, start, end);
    }
    if (!validation.ok) {
      throw new Error(
        `目录校验失败 ${start}-${end}：${validation.errors.slice(0, 5).join('；')}`
      );
    }
    segments.push(directory.trim());
    rollingSummary = `${rollingSummary}\n\n${directory}`.trim().slice(-3000);
    log(`  目录 ${start}-${end} 章 OK`);
  }
  return segments.join('\n\n');
}

async function generateFullDirectory(novelSetting, numChapters) {
  const MAX_PER_SEGMENT = 20;
  const parts = [];
  let rolling = '';
  for (let start = 1; start <= numChapters; start += MAX_PER_SEGMENT) {
    const end = Math.min(start + MAX_PER_SEGMENT - 1, numChapters);
    log(`生成目录 ${start}-${end}…`);
    const segment = await generateValidatedDirectorySegment(novelSetting, numChapters, {
      volumeStart: start,
      volumeEnd: end,
      previousVolumeSummary: rolling || undefined,
    });
    parts.push(segment);
    rolling = `${rolling}\n\n${segment}`.trim().slice(-4000);
  }
  return parts.join('\n\n');
}

function chapterFileExists(bookId, n) {
  return fs.existsSync(path.join(BOOKS_DIR, 'chapters', bookId, `${n}.txt`));
}

function buildChapterBody(project, parsed, n) {
  const info = getChapterInfo(parsed, n);
  const next = getChapterInfo(parsed, n + 1);
  const outlineWindow = parsed
    .filter((c) => c.number >= n - 3 && c.number <= n + 3)
    .map((c) => `第${c.number}章 ${c.title}：${c.summary || c.purpose || ''}`)
    .join('\n');
  const drafts = project.draftedChapters || {};
  let previousExcerpt;
  if (n > 1) {
    const prevPath = path.join(BOOKS_DIR, 'chapters', project._bookId, `${n - 1}.txt`);
    if (fs.existsSync(prevPath)) {
      previousExcerpt = fs.readFileSync(prevPath, 'utf8').slice(-2000);
    } else if (drafts[n - 1]) {
      previousExcerpt = String(drafts[n - 1]).slice(-2000);
    }
  }

  return {
    chapterNumber: n,
    title: info.title || `第${n}章`,
    chapterRole: info.role || '',
    chapterPurpose: info.purpose || '',
    chapterSummary: info.summary || '',
    novelSetting: (project.setting || '').slice(0, 4000),
    globalSummary: n === 1 ? undefined : (project.globalSummary || '').slice(-8000),
    previousExcerpt,
    characterState: project.characterState ? String(project.characterState).slice(-4000) : undefined,
    outlineWindow: outlineWindow || undefined,
    nextChapterTitle: next?.title,
    nextChapterSummary: next?.summary,
    wordNumber: project.wordPerChapter || 2200,
    topic: project.topic || '',
    voiceCard: project.voiceCard || '',
    stages: { consistency: true, finalize: true, qualityRepair: true },
  };
}

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(BOOKS_DIR, { recursive: true });

  const args = parseArgs(process.argv);
  const spec = loadSpec(path.resolve(args.spec));
  const cfg = getConfig();
  log(`模型: ${cfg.openaiModel || cfg.ollamaModel} (${cfg.provider})`);

  let bookId = args.bookId;
  let project;
  if (bookId) {
    ({ project } = loadBook(bookId));
    log(`续跑已有书 ${bookId}`);
  } else {
    ({ bookId, project } = createBook(spec));
  }
  project._bookId = bookId;

  if (!args.skipSetting && !project.setting?.trim()) {
    log('Step1 生成设定…');
    const { content } = await generateSetting(
      project.topic || spec.topic,
      project.genre || spec.genre,
      project.numChapters || spec.numChapters,
      project.wordPerChapter || spec.wordPerChapter
    );
    project.setting = content;
    if (!project.voiceCard && spec.voiceCard) project.voiceCard = spec.voiceCard;
    saveProject(bookId, project);
    log(`设定完成 (${content.length} 字)`);
  } else if (project.setting?.trim()) {
    log('跳过 Step1（已有设定）');
  }

  if (!args.skipDirectory && !project.directory?.trim()) {
    log('Step2 生成目录…');
    project.directory = await generateFullDirectory(
      project.setting,
      project.numChapters || spec.numChapters
    );
    saveProject(bookId, project);
    const parsed = parseDirectory(project.directory);
    log(`目录完成，共 ${parsed.length} 章条目`);
  } else if (project.directory?.trim()) {
    log('跳过 Step2（已有目录）');
  }

  const parsed = parseDirectory(project.directory || '');
  if (!parsed.length) {
    throw new Error('目录为空，无法写章');
  }

  const maxChapter = project.numChapters || spec.numChapters;
  const from = Math.max(1, args.from || 1);
  const to = args.to > 0 ? Math.min(args.to, maxChapter) : maxChapter;

  log(`Step3+4 写章 ${from}-${to}（humanize=${spec.humanizeStrength}）`);

  for (let n = from; n <= to; n += 1) {
    if (!args.force && chapterFileExists(bookId, n)) {
      log(`第 ${n} 章已存在，跳过`);
      project.lastGeneratedChapter = Math.max(project.lastGeneratedChapter || 0, n);
      continue;
    }

    const body = buildChapterBody(project, parsed, n);
    log(`第 ${n} 章「${body.title}」生成中…`);
    const started = Date.now();

    let result;
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      const skipConsistency = attempts > 1;
      result = await runChapterPipeline(
        {
          ...body,
          humanizeStrength: spec.humanizeStrength,
          stages: {
            ...body.stages,
            consistency: skipConsistency ? false : body.stages?.consistency !== false,
          },
        },
        (ev) => {
          if (ev.percent >= 85) log(`  ${ev.message || ev.stage}`);
        }
      );
      if (result.ok) break;
      log(`  第 ${n} 章失败 (${attempts}/3): ${result.error}${skipConsistency ? '（已跳过一致性）' : ''}`);
    }

    if (!result?.ok) {
      log(`第 ${n} 章最终失败，停止。可 --book-id ${bookId} --from ${n} 续跑`);
      process.exitCode = 1;
      return;
    }

    saveChapterFile(bookId, n, result.content);
    project.globalSummary = result.summary ?? project.globalSummary;
    project.characterState = result.characterState ?? project.characterState;
    project.lastGeneratedChapter = n;
    project.draftedChapters = migrateDraftedChaptersToFiles(bookId, project.draftedChapters);
    writeJson(getBookPath(bookId), project);

    const chars = (result.content || '').replace(/\s/g, '').length;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    log(`第 ${n} 章完成 ${chars} 字，${elapsed}s`);
  }

  saveProject(bookId, project);
  log(`全部完成 bookId=${bookId} lastChapter=${project.lastGeneratedChapter}`);
  log(`在前端选择此书即可查看 / Step5 排程发布`);
}

main().catch((e) => {
  log(`致命错误: ${e.message}`);
  console.error(e);
  process.exit(1);
});
