// 番茄推流验证分测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePromotion, scorePromotionBook } from '../src/writer/promotionScore.js';
import { checkMetaphorDensity } from '../src/writer/autoRepair.js';

function makeChapter() {
  const paras = [];
  paras.push('手机突然震了一下，系统警告弹出。');
  paras.push('林渡盯着屏幕，倒计时在跳。');
  for (let i = 0; i < 60; i++) {
    paras.push('他压低声音，把手机往兜里一塞。');
    paras.push('“快走。”');
    paras.push('路灯下影子拉长，他拐进巷子。');
    paras.push('手机屏幕自己亮了，弹出一条新消息。');
    paras.push('林渡咬紧牙关，冲过路口。');
  }
  return paras.join('\n\n') + '\n\n【明晚零点，大额订单开拍前，你会回来】';
}

test('合格章节达到满分', () => {
  const text = makeChapter();
  const r = scorePromotion(text, 2000);
  assert.equal(r.total, 60, '合格章节应为 60 分，实际 ' + r.total + '，' + r.fixHints.join('；'));
  assert.equal(r.ok, true);
});

test('省略号刷屏扣 AI 味分', () => {
  const text = makeChapter().replace(/。/g, '……');
  const r = scorePromotion(text, 2000);
  assert.ok(r.total < 60, '省略号刷屏应扣分');
  const aiDim = r.dims.find((d) => d.name === 'AI味控制');
  assert.ok(aiDim.score < 10);
});

test('无标点长句被扣格式分', () => {
  const longRun = '林渡后颈还贴着商场玻璃的凉气眼前那些字一层叠一层活人头顶全在冒愿望他连脚边台阶都看不见。';
  const r = scorePromotion(longRun, 2000);
  const fmt = r.dims.find((d) => d.name === '格式合规');
  assert.ok(fmt.score < 10, '无标点长句应扣格式分');
});

test('比喻密度检测', () => {
  const ok = checkMetaphorDensity('他走了。她笑了。', 3);
  assert.equal(ok.ok, true);
  const bad = checkMetaphorDensity('像蛇一样爬。像蛇一样扭。像蛇一样缠。像蛇一样盘。像蛇一样滑。像蛇一样钻。像蛇一样吐信。像蛇一样竖。像蛇一样游。像蛇一样盘。像蛇一样缠。像蛇一样爬。', 3);
  assert.equal(bad.ok, false, '比喻密度超标应检测出来');
});

test('全书统计', () => {
  const book = scorePromotionBook([
    { n: 1, text: makeChapter(), target: 2000 },
    { n: 2, text: makeChapter(), target: 2000 },
  ]);
  assert.equal(book.summary.passed, 2);
  assert.equal(book.summary.fullMark, true);
});
