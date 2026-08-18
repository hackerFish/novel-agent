/**
 * 问题台账（Lessons Log）：记录创作中发现的真实问题，写章时注入提示词防再犯
 * 闭环：发现问题（审查/检测/用户反馈）→ 记台账 → 写章提示词注入「已知易错点」→ 生成验证
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_FILE = path.join(__dirname, '..', '..', '.t-book-state', 'lessons.json');

function load() {
  fs.mkdirSync(path.dirname(LESSONS_FILE), { recursive: true });
  try {
    if (fs.existsSync(LESSONS_FILE)) return JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
  } catch { /* 重建 */ }
  return { list: [] };
}

function save(data) {
  fs.mkdirSync(path.dirname(LESSONS_FILE), { recursive: true });
  fs.writeFileSync(LESSONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** 全部台账 */
export function getLessons() {
  return load().list || [];
}

/**
 * 记录一条问题教训
 * @param {object} opts { type, problem, example, fix, source, severity }
 * type: 语病|真实语域|AI味|格式|断句|复述事故|结构|人设|爽点|其他
 */
export function addLesson({ type = '其他', problem = '', example = '', fix = '', source = '手动', severity = '中' } = {}) {
  if (!problem) return null;
  const data = load();
  const exist = data.list.find((l) => l.problem === problem);
  if (exist) {
    exist.count = (exist.count || 1) + 1;
    exist.lastSeenAt = new Date().toISOString();
    save(data);
    return exist;
  }
  const item = {
    id: 'L' + Date.now().toString(36),
    type, problem, example, fix, source, severity,
    count: 1, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  };
  data.list.unshift(item);
  // 只保留最近 100 条
  if (data.list.length > 100) data.list.length = 100;
  save(data);
  return item;
}

/** 删除台账条目 */
export function removeLesson(id) {
  const data = load();
  data.list = data.list.filter((l) => l.id !== id);
  save(data);
  return { ok: true };
}

/**
 * 生成「已知易错点」提示词片段（写章注入，防止再犯）
 * 取最近出现的 N 条（按 lastSeenAt 排序）
 */
export function formatLessonsSection(max = 5) {
  const list = getLessons()
    .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
    .slice(0, max);
  if (!list.length) return '';
  const lines = list.map((l) => {
    const ex = l.example ? `（错误示例：${l.example.slice(0, 40)}）` : '';
    return `- 【${l.type}】${l.problem}${ex}${l.fix ? `。正确做法：${l.fix}` : ''}`;
  });
  return `【已知易错点】（历史教训，写作时必须避免，违反会直接被判定不合格）\n${lines.join('\n')}`;
}

/** 预置本项目已发现的核心问题（初始化台账） */
export function seedDefaultLessons() {
  const seeds = [
    { type: '语病', problem: '「还没睡」应为「还没睡醒」', example: '林渡觉得自己还没睡，手机震得跟催债一样', fix: '搭配错误要自查通顺', source: '用户反馈', severity: '高' },
    { type: '真实语域', problem: '禁止发明工具名「接单器」', example: '林渡的接单器夹在车把上', fix: '外卖员用手机/接单APP', source: '用户反馈', severity: '高' },
    { type: '真实语域', problem: '「不可转卖」应为「不可转单」', example: '且不可转卖', fix: '平台行话是转单', source: '用户反馈', severity: '高' },
    { type: '断句', problem: '系统面板【】内容被断句切开', example: '且不。可转卖', fix: '【】内不断句，像真实APP弹窗', source: '用户反馈', severity: '高' },
    { type: '复述事故', problem: '模型把指令复述进正文', example: '我们需要回答用户请求……', fix: '生成后检测复述特征，重试', source: '自动检测', severity: '严重' },
    { type: 'AI味', problem: '瞳孔/嘴角模板动作滥用', example: '他瞳孔缩了一下、嘴角抽了一下', fix: '换具体动作（眼神一缩/嘴皮子抽）', source: '审查', severity: '中' },
    { type: 'AI味', problem: '比喻堆砌（像…连发）', example: '像条蛇在爬。像根引线。像口棺材', fix: '每400字不超过3个比喻，删一半', source: '三方审查', severity: '中' },
    { type: '人设', problem: '主角被动（被系统/配角推着走）', example: '全程被动接单、被动配合', fix: '主角要主动钻规则、有决策', source: '三方审查', severity: '高' },
    { type: '结构', problem: '爽点无闭环（能力获得后无打脸兑现）', example: '获得能力后主角吐槽有屁用', fix: '能力当场兑现打脸', source: '整书打磨', severity: '高' },
    { type: '格式', problem: '首句过长（>40字无句号）', example: '接单器跳出【…】的同时，面包车横在路中央', fix: '首句短促，直给事件', source: '推流分', severity: '中' },
  ];
  let added = 0;
  for (const s of seeds) {
    const exist = load().list.find((l) => l.problem === s.problem);
    if (!exist) { addLesson(s); added++; }
  }
  return { added };
}
