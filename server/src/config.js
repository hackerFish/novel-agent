import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 配置文件路径（存于 server 目录，不提交 git） */
const CONFIG_PATH = path.join(__dirname, '..', '.t-book-config.json');

const DEFAULTS = {
  provider: 'ollama',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:14b',
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  openaiApiKey: '',
  openaiModel: 'deepseek-v4-pro',
  openaiModelAux: 'deepseek-v4-flash',
};

let runtime = { ...DEFAULTS };

function loadFromFile() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        Object.keys(DEFAULTS).forEach((key) => {
          if (data[key] !== undefined) runtime[key] = data[key];
        });
      }
    }
  } catch (_) {
    // 文件损坏或不存在时保持默认
  }
}

function saveToFile() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(runtime, null, 2), 'utf8');
  } catch (e) {
    console.warn('执笔 NovelAgent 配置保存失败:', e.message);
  }
}

// 启动时加载已保存的配置
loadFromFile();

export function getConfig() {
  return { ...runtime };
}

export function setConfig(updates) {
  if (updates && typeof updates === 'object') {
    Object.assign(runtime, updates);
    saveToFile();
  }
  return getConfig();
}
