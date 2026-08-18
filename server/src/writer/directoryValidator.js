import { parseDirectory } from './directoryParser.js';

/**
 * 校验目录片段：检查章节范围、格式完整性、无重复无缺漏
 * @param {string} rawText - 本段目录原文
 * @param {number} volumeStart - 期望起始章
 * @param {number} volumeEnd - 期望结束章
 * @returns {{ ok: boolean, errors: string[], parsed: Array }}
 */
export function validateDirectorySegment(rawText, volumeStart, volumeEnd) {
  const errors = [];
  const parsed = parseDirectory(rawText || '');
  const numbers = parsed.map((c) => c.number).sort((a, b) => a - b);

  if (parsed.length === 0) {
    errors.push('未解析到任何章节，请确保每章以「第N章 - 标题」或「N.标题 – 描述」格式开头。');
    return { ok: false, errors, parsed };
  }

  const minNum = Math.min(...numbers);
  const maxNum = Math.max(...numbers);

  if (minNum > volumeStart) {
    errors.push(`缺少起始章：应从第 ${volumeStart} 章开始，实际从第 ${minNum} 章开始。`);
  }
  if (maxNum < volumeEnd) {
    errors.push(`章节不足：应到第 ${volumeEnd} 章，实际只到第 ${maxNum} 章（少 ${volumeEnd - maxNum} 章）。`);
  }

  const expectedSet = new Set();
  for (let i = volumeStart; i <= volumeEnd; i++) expectedSet.add(i);
  const gotSet = new Set(numbers);
  const missing = [...expectedSet].filter((n) => !gotSet.has(n));
  const extra = numbers.filter((n) => n < volumeStart || n > volumeEnd);
  if (missing.length > 0) {
    const show = missing.length <= 5 ? missing.join('、') : `第 ${missing.slice(0, 3).join('、')} … 等 ${missing.length} 章`;
    errors.push(`缺章：${show}。`);
  }
  if (extra.length > 0) {
    errors.push(`多出本段范围外的章节：${[...new Set(extra)].join('、')}。`);
  }

  const duplicate = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (duplicate.length > 0) {
    errors.push(`重复章节号：${[...new Set(duplicate)].join('、')}。`);
  }

  for (const ch of parsed) {
    if (ch.number < volumeStart || ch.number > volumeEnd) continue;
    if (!ch.title || ch.title.length < 2) {
      errors.push(`第 ${ch.number} 章标题过短或为空。`);
    }
    if (!ch.role) {
      errors.push(`第 ${ch.number} 章缺少「本章定位」行。`);
    }
    if (!ch.purpose) {
      errors.push(`第 ${ch.number} 章缺少「核心作用」行。`);
    }
    if (!ch.suspense) {
      errors.push(`第 ${ch.number} 章缺少「悬念密度」行。`);
    }
    if (!ch.summary) {
      errors.push(`第 ${ch.number} 章缺少「本章简述」行。`);
    }
    if (ch.rawBlock.length < 4) {
      errors.push(`第 ${ch.number} 章不是标准 5 行格式，不能把多个字段挤在同一行。`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    parsed,
  };
}
