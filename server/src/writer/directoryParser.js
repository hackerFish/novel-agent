/**
 * 解析 Step2 生成的章节目录，支持多种格式：
 * 1) 第N章 - 标题 + 本章定位/核心作用/悬念密度/本章简述
 * 2) 第N章-标题（无空格）
 * 3) N.标题 – 描述(悬念) 单行格式
 * 4) 兼容错别字：本周定→本章定位，核作→核心作用，章节简→本章简述
 */
export function parseDirectory(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const chapters = [];
  let current = null;

  for (const line of lines) {
    // 格式1/2: 第N章 - 标题 或 第N章-标题
    const matchChapter = line.match(/^第\s*(\d+)\s*章\s*[-–—]?\s*(.*)$/);
    if (matchChapter) {
      if (current) chapters.push(current);
      const title = matchChapter[2].replace(/^[-–—:\s]+/, '').trim();
      current = {
        number: parseInt(matchChapter[1], 10),
        title: title || `第${matchChapter[1]}章`,
        role: '',
        purpose: '',
        suspense: '',
        summary: '',
        rawBlock: [],
      };
      continue;
    }

    // 格式3: 31.夜探任务的前期准备 – 装备检查与路线规划(缓冲)
    const matchOneLine = line.match(/^\s*(\d+)\.\s*(.+?)\s*[-–—]\s*(.+?)\s*[（(]([^）)]+)[）)]\s*$/);
    if (matchOneLine) {
      if (current) chapters.push(current);
      current = {
        number: parseInt(matchOneLine[1], 10),
        title: matchOneLine[2].trim(),
        role: '',
        purpose: '',
        suspense: matchOneLine[4].trim(),
        summary: matchOneLine[3].trim(),
        rawBlock: [line],
      };
      chapters.push(current);
      current = null;
      continue;
    }

    // 格式3 变体: 31.标题 – 描述 或 31. 标题（无括号）
    const matchOneLineShort = line.match(/^\s*(\d+)\.\s*(.+?)\s*[-–—]\s*(.+)$/);
    if (matchOneLineShort) {
      if (current) chapters.push(current);
      current = {
        number: parseInt(matchOneLineShort[1], 10),
        title: matchOneLineShort[2].trim(),
        role: '',
        purpose: '',
        suspense: '',
        summary: matchOneLineShort[3].trim(),
        rawBlock: [line],
      };
      chapters.push(current);
      current = null;
      continue;
    }

    if (current) {
      current.rawBlock.push(line);
      // 兼容模型偶发错字/缩写：本周定、本定位、核心用、章节简述等。
      const roleMatch = line.match(/^(?:本章定位|本周定|本定位|本章位置|定位)\s*[：:]\s*(.+)$/);
      const purposeMatch = line.match(/^(?:核心作用|核心用|核作|作用)\s*[：:]\s*(.+)$/);
      const suspenseMatch = line.match(/^(?:悬念密度|悬念度|悬念|密度)\s*[：:]\s*(.+)$/);
      const summaryMatch = line.match(/^(?:本章简述|章节简述|本章简|章节简|简述)\s*[：:]\s*(.+)$/);
      if (roleMatch) current.role = roleMatch[1].trim();
      else if (purposeMatch) current.purpose = purposeMatch[1].trim();
      else if (suspenseMatch) current.suspense = suspenseMatch[1].trim();
      else if (summaryMatch) current.summary = summaryMatch[1].trim();
    }
  }
  if (current) chapters.push(current);

  return chapters.sort((a, b) => a.number - b.number);
}

/** 根据章节号取目录项；若解析不到则返回简单占位 */
export function getChapterInfo(parsedDirectory, chapterNumber) {
  const one = parsedDirectory.find((c) => c.number === chapterNumber);
  if (one) return one;
  return {
    number: chapterNumber,
    title: `第${chapterNumber}章`,
    role: '',
    purpose: '',
    suspense: '',
    summary: '',
    rawBlock: [],
  };
}
