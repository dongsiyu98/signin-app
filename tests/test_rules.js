// 规则引擎单元测试（里程碑式奖金：连续达到某天才一次发该档；断签后已发保留）
// 本文件位于 tests/ 目录，server.js 在上级目录
const path = require('path');
const { computeState } = require(path.join(__dirname, '..', 'server.js'));

const A = {
  cycleDays: 30, fee: 25, refundRealDays: 5,
  tiers: [{ day: 5, per: 5 }, { day: 10, per: 10 }, { day: 20, per: 15 }, { day: 30, per: 20 }],
  milestones: [{ day: 5, add: 25 }, { day: 10, add: 50 }, { day: 20, add: 150 }, { day: 30, add: 200 }],
  cardDays: [7, 14, 21, 28]
};
const P = (join_date, cards_used = 0, fee_paid = 1) => ({ join_date, cards_used, fee_paid });
const C = (date) => ({ date, type: 'real', task_done: 1 });
const CM = (date) => ({ date, type: 'makeup', task_done: 1 });
let pass = 0, fail = 0;
function check(name, got, exp) {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log(`${ok ? '✅' : '❌'} ${name}: 期望 ${JSON.stringify(exp)} | 实际 ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

// 1. 刚加入、无签到 -> 全零
let s = computeState(A, P('2026-07-01'), [], '2026-07-01');
check('1.加入当天无签到', [s.curStreak, s.maxStreak, s.realDays, s.score, s.cardsHeld, s.inCycle, s.canCheckin], [0, 0, 0, 0, 0, true, true]);

// 2. 只签了第1天 -> 未达任何里程碑(门槛5天)，score=0
s = computeState(A, P('2026-07-01'), [C('2026-07-01')], '2026-07-01');
check('2.签到1天未达门槛', [s.curStreak, s.maxStreak, s.score, s.cardsHeld], [1, 1, 0, 0]);

// 3. 连续满5天 -> 达到第一个里程碑(5天→25)，退参与金
s = computeState(A, P('2026-07-01'),
  ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05'].map(C), '2026-07-05');
check('3.连续5天达首档&退还', [s.curStreak, s.maxStreak, s.score, s.realDays, s.refunded], [5, 5, 25, 5, true]);

// 4. 连续7天 -> maxStreak=7，仍只达第一个里程碑(5天→25)，第7天发卡
s = computeState(A, P('2026-07-01'),
  ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05','2026-07-06','2026-07-07'].map(C), '2026-07-07');
check('4.连续7天仅首档+发卡', [s.curStreak, s.maxStreak, s.score, s.cardsHeld], [7, 7, 25, 1]);

// 5. 断签：连续5天后断第6天，第7天重签 -> curStreak=1但maxStreak=5(历史最长)，已得25保留
s = computeState(A, P('2026-07-01'),
  ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05','2026-07-07'].map(C), '2026-07-07');
check('5.断签后已发保留', [s.curStreak, s.maxStreak, s.score, s.realDays, s.cardsHeld], [1, 5, 25, 6, 1]);

// 6. 补签：场景5基础上补签第6天 -> 连续段恢复为7天(curStreak=7,maxStreak=7)，仍仅首档
s = computeState(A, P('2026-07-01', 1),
  ['2026-07-01','2026-07-02','2026-07-03','2026-07-04','2026-07-05','2026-07-07'].map(C).concat([CM('2026-07-06')]), '2026-07-07');
check('6.补签后连续恢复&仅首档', [s.curStreak, s.maxStreak, s.score, s.cardsHeld, s.realDays, s.refunded], [7, 7, 25, 0, 6, true]);

// 7. 连续满10天 -> 达到两个里程碑(25+50=75)
const days10 = []; for(let i=1;i<=10;i++) days10.push(C('2026-07-'+String(i).padStart(2,'0')));
s = computeState(A, P('2026-07-01'), days10, '2026-07-10');
check('7.连续10天双档', [s.curStreak, s.maxStreak, s.score], [10, 10, 75]);

// 8. 连续满20天 -> 三个里程碑(25+50+150=225)
const days20 = []; for(let i=1;i<=20;i++) days20.push(C('2026-07-'+String(i).padStart(2,'0')));
s = computeState(A, P('2026-07-01'), days20, '2026-07-20');
check('8.连续20天三档', [s.curStreak, s.maxStreak, s.score], [20, 20, 225]);

// 9. 连续满30天 -> 四档全拿(25+50+150+200=425)
const days30 = [];
for(let i=1;i<=30;i++) days30.push(C('2026-07-'+String(i).padStart(2,'0')));
s = computeState(A, P('2026-07-01'), days30, '2026-07-30');
check('9.连续30天满分', [s.curStreak, s.maxStreak, s.score], [30, 30, 425]);

// 10. 未到退还门槛：真实4天
s = computeState(A, P('2026-07-01'),
  ['2026-07-01','2026-07-02','2026-07-03','2026-07-04'].map(C), '2026-07-04');
check('10.真实4天未退还', [s.realDays, s.refunded], [4, false]);

// 11. 周期外
s = computeState(A, P('2026-07-01'), [C('2026-07-01'),C('2026-07-02')], '2026-08-15');
check('11.超周期inCycle', s.inCycle, false);

// 12. 参加日之前
s = computeState(A, P('2026-07-10'), [], '2026-07-01');
check('12.参加日前inCycle', s.inCycle, false);

console.log(`\n=== 规则引擎测试（里程碑式）：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
