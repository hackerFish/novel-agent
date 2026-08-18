/**
 * 结构化状态管理：能力图鉴 + 伏笔追踪器
 * 为长篇（抽象愿望流）提供机械化的设定状态机，写章前注入、写完后更新。
 * 纯 JSON 存储，无需向量库/RAG——1M 上下文 + 结构化注入即可精确管理。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', '..', '.t-book-state');

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function statePath(bookId, kind) {
  return path.join(STATE_DIR, `${bookId}.${kind}.json`);
}

function readState(bookId, kind, fallback) {
  ensureDir();
  const p = statePath(bookId, kind);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* 损坏则重建 */ }
  return fallback;
}

function writeState(bookId, kind, data) {
  ensureDir();
  fs.writeFileSync(statePath(bookId, kind), JSON.stringify(data, null, 2), 'utf8');
}

/* ========== 能力图鉴（Abilities） ========== */

const emptyAbilities = { list: [], nextId: 1, updatedAt: null };

/** 读取能力图鉴 */
export function getAbilities(bookId) {
  const s = readState(bookId, 'abilities', emptyAbilities);
  return Array.isArray(s.list) ? s : { ...emptyAbilities };
}

/**
 * 追加新能力（每章完成后调用）
 * @param {object} opts { bookId, name, sourceWish, grade, firstAppearChapter, combo, note }
 */
export function addAbility(bookId, { name, sourceWish = '', grade = 'C', firstAppearChapter = 0, combo = '', note = '' } = {}) {
  if (!name) return null;
  const s = getAbilities(bookId);
  // 同名去重：更新来源章节
  const exist = s.list.find((a) => a.name === name);
  if (exist) {
    if (!exist.firstAppearChapter) exist.firstAppearChapter = firstAppearChapter;
    if (sourceWish) exist.sourceWish = sourceWish;
    exist.grade = grade;
    s.updatedAt = new Date().toISOString();
    writeState(bookId, 'abilities', s);
    return exist;
  }
  const item = {
    id: s.nextId++,
    name,
    sourceWish,
    grade,
    firstAppearChapter,
    combo: combo || '',
    note: note || '',
    usedCount: 0,
    status: 'active', // active | lost | upgraded
  };
  s.list.push(item);
  s.updatedAt = new Date().toISOString();
  writeState(bookId, 'abilities', s);
  return item;
}

/** 标记能力已使用（记录活跃度，防止"学会了不用"） */
export function markAbilityUsed(bookId, name) {
  const s = getAbilities(bookId);
  const a = s.list.find((x) => x.name === name);
  if (a) {
    a.usedCount = (a.usedCount || 0) + 1;
    a.lastUsedChapter = arguments[2] || a.lastUsedChapter;
    writeState(bookId, 'abilities', s);
  }
}

/**
 * 生成"能力图鉴摘要"注入写章 prompt：
 * 已有能力清单 + 最近 3 章新能力（防止 AI 遗忘/矛盾/重复）
 */
export function formatAbilitySection(bookId, currentChapter) {
  const s = getAbilities(bookId);
  if (!s.list.length) return '';
  const sorted = [...s.list].sort((a, b) => (a.firstAppearChapter || 0) - (b.firstAppearChapter || 0));
  const recent = sorted.filter((a) => currentChapter - (a.firstAppearChapter || 0) <= 3);
  const lines = sorted.map((a) => {
    const used = a.usedCount > 0 ? `（已用${a.usedCount}次）` : '（未用过）';
    return `- 【${a.name}】来源愿望：${a.sourceWish || '未知'}｜等级${a.grade}｜获得于第${a.firstAppearChapter || '?'}章${used}${a.combo ? `｜可组合：${a.combo}` : ''}`;
  });
  const recentNote = recent.length
    ? `\n【近期新能力（最近3章，必须记得使用或推进）】\n${recent.map((a) => `- 【${a.name}】`).join('\n')}`
    : '';
  return `【能力图鉴】（本书已获得的能力，正文中不得自相矛盾、不得遗忘、不得凭空重复获得）\n${lines.join('\n')}${recentNote}`;
}

/* ========== 伏笔追踪器（Foreshadowings） ========== */

const emptyForeshadows = { list: [], nextId: 1, updatedAt: null };

/** 读取伏笔表 */
export function getForeshadows(bookId) {
  const s = readState(bookId, 'foreshadows', emptyForeshadows);
  return Array.isArray(s.list) ? s : { ...emptyForeshadows };
}

/**
 * 登记/更新伏笔
 * @param {object} opts { bookId, content, plantChapter, harvestChapter, type, status }
 * status: planted(已埋) | active(推进中) | harvested(已回收) | forgotten(疑似遗忘)
 */
export function upsertForeshadow(bookId, { content = '', plantChapter = 0, harvestChapter = 0, type = 'identity', status = 'planted' } = {}) {
  if (!content) return null;
  const s = getForeshadows(bookId);
  const exist = s.list.find((f) => f.content === content);
  if (exist) {
    exist.status = status || exist.status;
    if (harvestChapter) exist.harvestChapter = harvestChapter;
    s.updatedAt = new Date().toISOString();
    writeState(bookId, 'foreshadows', s);
    return exist;
  }
  const item = {
    id: s.nextId++,
    content,
    type, // identity | truth | oldcase | character | rule
    plantChapter,
    harvestChapter: harvestChapter || 0,
    status, // planted | active | harvested | forgotten
  };
  s.list.push(item);
  s.updatedAt = new Date().toISOString();
  writeState(bookId, 'foreshadows', s);
  return item;
}

/**
 * 生成"伏笔状态摘要"注入写章 prompt：
 * - 当前章应"推进/回收"的伏笔
 * - 疑似遗忘的伏笔（埋设超过 20 章未推进）
 */
export function formatForeshadowSection(bookId, currentChapter) {
  const s = getForeshadows(bookId);
  if (!s.list.length) return '';
  const active = s.list.filter((f) => ['planted', 'active'].includes(f.status));
  const dueNow = active.filter((f) => f.harvestChapter > 0 && f.harvestChapter >= currentChapter - 1 && f.harvestChapter <= currentChapter + 2);
  const stale = active.filter((f) => f.plantChapter > 0 && currentChapter - f.plantChapter >= 20 && f.status !== 'harvested');
  const parts = [];
  if (dueNow.length) {
    parts.push(`【伏笔回收窗口（第 ${currentChapter} 章附近必须回收）】\n${dueNow.map((f) => `- ${f.content}（第${f.plantChapter}章埋设）`).join('\n')}`);
  }
  if (active.length) {
    parts.push(`【在途伏笔】（可推进但不必每章点明）\n${active.slice(0, 8).map((f) => `- ${f.content}（第${f.plantChapter}章埋设${f.harvestChapter ? `，计划第${f.harvestChapter}章回收` : ''}）`).join('\n')}`);
  }
  if (stale.length) {
    parts.push(`【疑似遗忘的伏笔】（埋设超过 20 章未推进，本章应至少带一笔或推进）\n${stale.slice(0, 5).map((f) => `- ${f.content}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** 按回收章自动批量回收（全本评估时调用） */
export function autoHarvest(bookId, maxChapter) {
  const s = getForeshadows(bookId);
  let changed = false;
  for (const f of s.list) {
    if (f.harvestChapter > 0 && f.harvestChapter <= maxChapter && f.status !== 'harvested') {
      f.status = 'harvested';
      changed = true;
    }
  }
  if (changed) writeState(bookId, 'foreshadows', s);
  return s.list.filter((f) => f.status !== 'harvested').length;
}
