// 断句引擎测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalFormatPass } from '../src/writer/formatEngine.js';

test('感官名词后断句：凉气→句号', () => {
  const text = '林渡后颈还贴着商场玻璃的凉气眼前那些字一层叠一层。';
  const out = applyLocalFormatPass(text);
  assert.ok(out.includes('凉气。'), '应在“凉气”后断句');
  assert.ok(!out.includes('凉气眼前那些字一层叠一层'), '长 run 应被断开');
});

test('【】系统行独立成段', () => {
  const text = '【绑定完成】他愣住。';
  const out = applyLocalFormatPass(text);
  assert.ok(out.includes('【绑定完成】\n\n'), '系统行应独立成段');
});

test('连续 20 字无标点被断开', () => {
  const text = '他抬头看见楼顶站着一个人影子拉得很长很细像一根竹竿。';
  const out = applyLocalFormatPass(text);
  // 按段落分别检查，每段无标点 run 应明显短于原文
  const maxRun = Math.max(...out.split('\n\n').map((p) => p.replace(/[，。！？…]/g, '').length));
  assert.ok(maxRun < 20, '每段无标点 run 应 <20，实际 ' + maxRun);
  // 不应切断"影子"
  assert.ok(!out.includes('人影。子'), '不应切断“影子”一词');
});

test('保留对话与原有标点', () => {
  const text = '“快走。”他压低声音。';
  const out = applyLocalFormatPass(text);
  assert.ok(out.includes('“快走。”'), '对话应保留');
  assert.ok(out.includes('他压低声音。'), '原句应保留');
});
