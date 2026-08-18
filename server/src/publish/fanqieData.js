/**
 * 番茄作家后台数据抓取（复用已保存登录态）
 * 用 Playwright 加载作家后台，从页面提取作品数据（阅读/在读/完读/追读等）
 * 注意：番茄后台是 SPA + 可能防爬；抓取器宽松匹配，失败返回明确提示。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '..', '..', '.t-book-fanqie-auth.json');
const DATA_FILE = path.join(__dirname, '..', '..', '.t-book-state', 'fanqie-data.json');

const WRITER_HOME = 'https://fanqienovel.com/main/writer/';

export function hasFanqieLogin() {
  return fs.existsSync(AUTH_FILE);
}

function saveData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getCachedFanqieData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { /* 无缓存 */ }
  return null;
}

/** 从页面文本中提取书籍数据块 */
function extractBooksFromText(text) {
  const books = [];
  // 番茄后台作品列表常见格式：书名 + 数据数字（宽松匹配）
  // 按行扫描，找"书名 + 紧跟数字行"的模式
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    // 书名启发式：2-20 字、不含常见导航词
    if (
      name.length >= 2 && name.length <= 24 &&
      !/^(首页|书库|书架|作家专区|版权专区|登录|注册|作品管理|数据中心|创作中心|作家福利|帮助|设置|退出)/.test(name) &&
      !/^\d/.test(name)
    ) {
      // 向后找数据数字（本行或后 1-3 行内的数字串）
      const nearby = lines.slice(i, i + 4).join(' ');
      const nums = nearby.match(/([\d,]+)\s*(万|个|人|次|章|本)/g) || [];
      if (nums.length > 0 && i > 0) {
        books.push({
          title: name,
          raw: nearby.slice(0, 120),
          numbers: nums.slice(0, 6),
          chapter: i,
        });
      }
    }
  }
  // 去重（同名取第一次）
  const seen = new Set();
  return books.filter((b) => {
    if (seen.has(b.title)) return false;
    seen.add(b.title);
    return true;
  }).slice(0, 20);
}

/**
 * 抓取番茄作家后台数据
 * @returns {{ ok, books, raw, fetchedAt, loginValid }}
 */
export async function fetchFanqieData({ timeoutMs = 120000 } = {}) {
  if (!hasFanqieLogin()) {
    return { ok: false, error: '尚未登录番茄，请先在 Step5 点「登录番茄」' };
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: AUTH_FILE });
    const page = await context.newPage();
    await page.goto(WRITER_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // 检测登录是否有效：排除登录页特征，再找后台特征
    const text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
    const isLoginPage = /验证码登录|扫码登录|获取验证码|密码登录/.test(text);
    const loginValid = !isLoginPage && /作品管理|数据中心|创作中心|我的作品/.test(text);

    // 尝试进入作品管理/数据中心
    let dataText = text;
    for (const href of ['/main/writer/works', '/main/writer/work', '/main/writer/data']) {
      try {
        await page.goto('https://fanqienovel.com' + href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);
        const t = await page.evaluate(() => document.body.innerText);
        if (t.length > dataText.length) dataText = t;
        if (/(阅读|在读|完读|追读|收藏|粉丝)/.test(t)) break;
      } catch { /* 继续尝试 */ }
    }

    const books = extractBooksFromText(dataText);
    const result = {
      ok: true,
      loginValid,
      books,
      rawPreview: dataText.slice(0, 1500),
      fetchedAt: new Date().toISOString(),
    };
    saveData(result);
    return result;
  } catch (e) {
    return { ok: false, error: '抓取失败: ' + e.message };
  } finally {
    await browser.close();
  }
}
