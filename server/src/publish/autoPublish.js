/**
 * 番茄自动发布（浏览器自动化）
 * 番茄作家后台无公开 API，采用 Playwright 模拟人工操作：
 * 1. ensureLogin：打开浏览器 → 用户手动登录/扫码一次 → 登录态保存到本地文件
 * 2. publishChapter：加载登录态 → 打开新建章节页 → 填标题/正文 → 保存
 * 3. 排程调度：按项目 publishStates 中的建议发布时间自动发布
 *
 * 注意：番茄有风控，发布频率请控制在每日 2-3 章以内，并开启随机延迟模拟人工。
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '..', '..', '.t-book-fanqie-auth.json');
const STATE_FILE = path.join(__dirname, '..', '..', '.t-book-publish-state.json');

const FANQIE_WRITER_HOME = 'https://fanqienovel.com/main/writer/';

let browserInstance = null;
let schedulerTimer = null;

/** 启动浏览器（有头模式，方便登录与排障） */
async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await chromium.launch({ headless: false });
  return browserInstance;
}

/**
 * 登录引导：打开作家后台，等待用户手动登录（扫码/账密），
 * 检测到登录成功后保存 storageState。resolve 后即可关闭浏览器。
 */
export async function ensureLogin({ timeoutMs = 300000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(FANQIE_WRITER_HOME, { waitUntil: 'domcontentloaded' });

  // 轮询检测是否已登录：作家后台登录后 URL 保持 /main/writer/ 且页面出现作者名/作品管理
  const deadline = Date.now() + timeoutMs;
  let loggedIn = false;
  while (Date.now() < deadline) {
    try {
      const url = page.url();
      const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : '');
      // 登录成功特征：出现「作品管理/作家福利/新建作品」等后台字样
      if (/作品管理|作家福利|我的作品|创作中心|新建作品/.test(text)) {
        loggedIn = true;
        break;
      }
    } catch { /* 页面跳转中 */ }
    await page.waitForTimeout(3000);
  }

  if (!loggedIn) {
    await browser.close();
    browserInstance = null;
    throw new Error('登录超时：请在打开的浏览器中完成登录（扫码或账密）。');
  }

  // 保存登录态
  await context.storageState({ path: AUTH_FILE });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ loggedInAt: new Date().toISOString() }, null, 2));
  await context.close();
  return { ok: true, saved: AUTH_FILE };
}

function hasLogin() {
  return fs.existsSync(AUTH_FILE);
}

/**
 * 发布一章到番茄。
 * @param {object} opts { title, content, scheduleMinutes } scheduleMinutes>0 表示设置定时发布（分钟数）
 * 流程：加载登录态 → 打开作家后台 → 尝试进入新建章节页（优先记忆上次的章节管理 URL，其次后台首页人工导航）→ 填充 → 保存
 */
export async function publishChapter({ title = '', content = '', scheduleMinutes = 0 } = {}) {
  if (!hasLogin()) {
    throw new Error('尚未登录番茄，请先调用 /api/publish/auto/login 完成一次登录。');
  }
  if (!content || content.trim().length < 800) {
    throw new Error('正文为空或过短（<800字），番茄要求单章 ≥800 字。');
  }

  const browser = await getBrowser();
  const context = await browser.newContext({ storageState: AUTH_FILE });
  const page = await context.newPage();

  // 打开作家后台
  await page.goto(FANQIE_WRITER_HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 尝试打开「章节管理」：常见路径规则，失败则让用户手动导航
  const chapterMgmtCandidates = [
    'https://fanqienovel.com/main/writer/works',
    'https://fanqienovel.com/main/writer/work',
  ];
  let opened = false;
  for (const url of chapterMgmtCandidates) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const text = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2000) : '');
      if (/新建章节|章节管理|新增章节/.test(text)) { opened = true; break; }
    } catch { /* continue */ }
  }

  if (!opened) {
    throw new Error('未能自动定位「章节管理」页面。番茄后台界面可能已更新：请在打开的浏览器中手动进入该书的章节管理页并点击「新建章节」，然后重试（登录态已保存，不会要求重新登录）。');
  }

  // 点「新建章节」
  const newBtn = page.getByText('新建章节').first();
  await newBtn.click({ timeout: 15000 });
  await page.waitForTimeout(2500);

  // 填充标题：找标题输入框
  const titleInput = page.locator('input[placeholder*="标题"], textarea[placeholder*="标题"], input[placeholder*="章节名"]').first();
  await titleInput.fill(title, { timeout: 15000 });

  // 填充正文：番茄编辑器通常是 contenteditable
  const editor = page.locator('[contenteditable="true"]').first();
  if (await editor.count()) {
    await editor.click();
    await page.keyboard.insertText(content);
  } else {
    const bodyArea = page.locator('textarea').nth(1);
    if (await bodyArea.count()) {
      await bodyArea.fill(content);
    } else {
      throw new Error('未找到正文编辑器（contenteditable 或 textarea）。番茄后台界面可能已更新，请在浏览器中手动粘贴正文。');
    }
  }

  // 随机延迟模拟人工
  await page.waitForTimeout(1500 + Math.floor(Math.random() * 2000));

  // 保存：优先「定时发布」，否则「保存」
  if (scheduleMinutes > 0) {
    const scheduleBtn = page.getByText('定时发布').first();
    if (await scheduleBtn.count()) {
      await scheduleBtn.click();
      await page.waitForTimeout(1500);
      // 定时选择（分钟级/日期级选择器差异大，统一等待后直接确认）
      const confirmBtn = page.getByText('确定').first();
      if (await confirmBtn.count()) await confirmBtn.click();
    }
  }
  const saveBtn = page.getByText('保存').first();
  await saveBtn.click({ timeout: 15000 });
  await page.waitForTimeout(3000);

  await context.close();
  return { ok: true, publishedAt: new Date().toISOString() };
}

/**
 * 启动排程调度：每 60 秒检查一次未发布章节的建议发布时间，到点自动发布。
 * @param {object} state { chapters: [{ chapterNumber, title, content, scheduledAt }] }
 */
export function startScheduler(getQueue) {
  if (schedulerTimer) return { ok: true, alreadyRunning: true };
  schedulerTimer = setInterval(async () => {
    try {
      const queue = typeof getQueue === 'function' ? getQueue() : [];
      const now = Date.now();
      const due = queue.filter((c) => c.scheduledAt && new Date(c.scheduledAt).getTime() <= now && !c.published);
      for (const ch of due) {
        try {
          const r = await publishChapter({ title: ch.title, content: ch.content });
          ch.published = r.ok;
          ch.publishedAt = r.publishedAt;
          console.log(`[auto-publish] 已发布第 ${ch.chapterNumber} 章`);
        } catch (e) {
          console.error(`[auto-publish] 第 ${ch.chapterNumber} 章发布失败:`, e.message);
        }
        await new Promise((r) => setTimeout(r, 20000)); // 章节间隔，降低风控
      }
    } catch (e) {
      console.error('[auto-publish] 调度异常:', e.message);
    }
  }, 60000);
  return { ok: true };
}

export function stopScheduler() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  return { ok: true };
}

export function getStatus() {
  return {
    loggedIn: hasLogin(),
    authFile: AUTH_FILE,
    schedulerRunning: !!schedulerTimer,
  };
}
