// 去 AI 味引擎测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDeAi, humanizePunctuationSafe } from '../src/writer/humanize.js';

test('localDeAi 删除 AI 高频词', () => {
  const out = localDeAi('他不禁笑了，顿时安静下来，微微点头，瞬间反应过来，非常害怕。');
  assert.ok(!out.includes('不禁'), '不禁 应被删除');
  assert.ok(!out.includes('顿时'), '顿时 应被删除');
  assert.ok(!out.includes('微微'), '微微 应被删除');
  assert.ok(!out.includes('瞬间'), '瞬间 应被删除');
  assert.ok(!out.includes('非常'), '非常 应被删除');
});

test('localDeAi 仿佛→像', () => {
  const out = localDeAi('他仿佛在说。');
  assert.equal(out, '他像在说。');
});

test('localDeAi 嘴角抽→嘴皮子抽，保留嘴角裂开', () => {
  const out = localDeAi('他嘴角抽了一下。瘦高个笑了一下，嘴角裂开，没到眼睛。');
  assert.ok(out.includes('嘴皮子抽'), '嘴角抽 应替换为 嘴皮子抽');
  assert.ok(out.includes('嘴角裂开'), '嘴角裂开 是有效描写应保留');
});

test('localDeAi 清理替换产生的双标点', () => {
  const out = localDeAi('他非常，非常生气。');
  assert.ok(!out.includes('，,'), '不应出现双逗号');
});

test('humanizePunctuationSafe 全链路不改变剧情', () => {
  const text = '他说道：“我们走。”然后他突然转身，非常愤怒地瞪了一眼。';
  const out = humanizePunctuationSafe(text, 0.8);
  assert.ok(out.includes('我们走'), '对话内容应保留');
  assert.ok(!out.includes('非常'), 'AI 词应被处理');
});
