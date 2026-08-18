/**
 * 番茄定时发布排程：按起始日、每日章数、时段生成建议发布时间
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateOnly(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * @param {object} options
 * @param {number[]} options.chapterNumbers - 待排程章节号（已排序）
 * @param {string} options.startDate - YYYY-MM-DD
 * @param {number} options.chaptersPerDay - 1 或 2
 * @param {string[]} options.timeSlots - 如 ['12:00', '20:30']
 * @param {Date} [options.now] - 测试用
 */
export function buildPublishSchedule(options) {
  const {
    chapterNumbers = [],
    startDate,
    chaptersPerDay = 2,
    timeSlots = ['12:00', '20:30'],
    now = new Date(),
  } = options;

  const slots = (chaptersPerDay === 1 ? [timeSlots[0] || '12:00'] : timeSlots.slice(0, 2)).filter(Boolean);
  if (!slots.length) slots.push('12:00');

  let cursor = parseDateOnly(startDate) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const schedule = [];
  let slotIndex = 0;
  let daySlotUsed = 0;

  for (const chapterNumber of chapterNumbers) {
    if (daySlotUsed >= slots.length) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      daySlotUsed = 0;
      slotIndex = 0;
    }

    const [hh, mm] = slots[slotIndex].split(':').map(Number);
    let scheduled = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), hh || 12, mm || 0, 0);

    // 若排到今天且时间已过，顺延到下一可用时段/下一天
    while (scheduled < now) {
      daySlotUsed += 1;
      slotIndex += 1;
      if (daySlotUsed >= slots.length) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
        daySlotUsed = 0;
        slotIndex = 0;
      }
      const [h2, m2] = slots[slotIndex].split(':').map(Number);
      scheduled = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), h2 || 12, m2 || 0, 0);
    }

    // 不要排到 startDate 之前的日期
    if (scheduled < todayStart && parseDateOnly(startDate)) {
      cursor = parseDateOnly(startDate);
      daySlotUsed = 0;
      slotIndex = 0;
      const [h3, m3] = slots[0].split(':').map(Number);
      scheduled = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), h3 || 12, m3 || 0, 0);
      while (scheduled < now) {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
        scheduled = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), h3 || 12, m3 || 0, 0);
      }
    }

    schedule.push({
      chapterNumber,
      scheduledAt: formatDateTime(scheduled),
      date: `${scheduled.getFullYear()}-${pad2(scheduled.getMonth() + 1)}-${pad2(scheduled.getDate())}`,
      time: `${pad2(scheduled.getHours())}:${pad2(scheduled.getMinutes())}`,
    });

    daySlotUsed += 1;
    slotIndex = daySlotUsed % slots.length;
  }

  return schedule;
}

export function buildChapterTitle(chapterInfo, number) {
  const title = (chapterInfo?.title || '').trim();
  if (!title) return `第${number}章`;
  if (/^第\s*\d+/.test(title)) return title.replace(/^第\s*(\d+)/, (_, n) => `第${n}章`);
  return `第${number}章 ${title}`;
}

export function countContentChars(text) {
  return String(text || '').replace(/\s/g, '').length;
}

export const DEFAULT_PUBLISH_CONFIG = {
  startDate: '',
  chaptersPerDay: 2,
  timeSlots: ['12:00', '20:30'],
  startChapter: 1,
  onlyUnpublished: true,
};

export function normalizePublishConfig(raw = {}) {
  return {
    startDate: raw.startDate || new Date().toISOString().slice(0, 10),
    chaptersPerDay: raw.chaptersPerDay === 1 ? 1 : 2,
    timeSlots: Array.isArray(raw.timeSlots) && raw.timeSlots.length
      ? raw.timeSlots.slice(0, 2)
      : ['12:00', '20:30'],
    startChapter: Math.max(1, Number(raw.startChapter) || 1),
    onlyUnpublished: raw.onlyUnpublished !== false,
  };
}
