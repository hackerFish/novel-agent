// 去 AI 味定位测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateAiFlavor } from '../src/writer/aiIndex.js';

test('干净文本指数高、问题句少', () => {
  const text = '他推开铁门。\n风灌进来。\n“进来吧。”\n她低头擦桌子。';
  const r = locateAiFlavor(text);
  assert.ok(r.index >= 8, '干净文本指数应高，实际 ' + r.index);
});

test('省略号刷屏被定位为问题句', () => {
  const text = '他愣在原地半天没动……然后慢慢笑了一下……最后转身走了……嘴里什么都没说……';
  const r = locateAiFlavor(text);
  assert.ok(r.problemCount >= 1, '省略号句应被定位');
  assert.ok(r.sentences.some((s) => s.reasons.some((x) => x.includes('省略号'))), '应标注省略号原因');
});

test('长句被定位', () => {
  const text = '他抬头看见楼顶站着一个人影子拉得很长很细像一根竹竿直直插在地里一动不动让人后背发凉。';
  const r = locateAiFlavor(text);
  assert.ok(r.sentences.some((s) => s.reasons.some((x) => x.includes('长句'))), '长句应被定位');
});

test('指数范围 0-10', () => {
  const r = locateAiFlavor('“嗯。”他应了一声。');
  assert.ok(r.index >= 0 && r.index <= 10, '指数应在 0-10');
});
