// 前端集成测试：用 jsdom 加载页面，fetch 指向真实运行的服务器，模拟真实 UI 流程
// 本文件位于 tests/ 目录，页面在上级 public/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const BASE = 'http://localhost:' + (process.env.PORT || 3000);

// 安全护栏：禁止测试脚本直连生产端口(3000)，以免污染生产数据库
if (!process.env.RUN_VIA_TESTALL && (process.env.PORT || 3000) === 3000) {
  console.error('⛔ 安全拦截：测试脚本禁止直连生产端口(3000)，以免污染生产数据库。');
  console.error('   请通过 `npm test`（自动使用隔离测试库 test_signin.db :3001）运行；');
  console.error('   手动调试请指定非 3000 端口，例如：PORT=3001 node --experimental-sqlite tests/test_frontend.js');
  process.exit(1);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  url: BASE + '/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
    w.onerror = (m) => errors.push('onerror: ' + m);
  }
});
const { window } = dom;
const { document } = window;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
let pass = 0, fail = 0;
function ok(name, cond, extra) { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`); cond ? pass++ : fail++; }

(async () => {
  await wait(200);
  ok('页面加载无 JS 错误', errors.length === 0, errors.join('; '));
  ok('api() 助手已定义', typeof window.api === 'function');
  ok('localStorage 可用', !!window.localStorage);

  // 1. 真实 UI 注册：切到注册模式 -> 填表 -> doAuth
  const nick = '前端_' + Date.now();
  window.toggleAuth(); // login -> register
  document.getElementById('au_name').value = nick;
  document.getElementById('au_pass').value = 'test1234';
  await window.doAuth();
  await wait(150);
  ok('注册后 token 已存入 localStorage', !!window.localStorage.getItem('token'));
  ok('注册后进入应用视图', !document.getElementById('app').classList.contains('hidden'));
  ok('昵称与注册一致', (document.getElementById('whoami').textContent || '') === nick);

  // 2. 发布活动（作家签到参数），用 api() 直接拿返回
  const act = {
    name: '作家签到·前端测试', icon: '✍️', description: 't', cycleDays: 30, fee: 25, refundRealDays: 5,
    taskReq: '完成1小时小说', tiers: [{ day: 5, per: 5 }, { day: 10, per: 10 }, { day: 20, per: 15 }, { day: 30, per: 20 }],
    milestones: [{ day: 5, add: 25 }, { day: 10, add: 50 }, { day: 20, add: 150 }, { day: 30, add: 200 }],
    cardDays: [7, 14, 21, 28], labels: { score: '奖金', fee: '参与金', feeRefund: '已退参与金', poolAdd: '奖池加注', card: '补签卡' }
  };
  const created = await window.api('/api/activities', { method: 'POST', body: act });
  ok('发布活动返回 id', !!(created && created.id), JSON.stringify(created));
  const aid = created.id;

  // 3. 进入详情（UI 函数），观察 DOM 渲染
  await window.showDetail(aid);
  await wait(120);
  const viewHTML = document.getElementById('view').innerHTML;
  ok('详情页渲染出活动名', viewHTML.includes('作家签到·前端测试'));
  ok('详情页渲染出「参加」按钮(未参加)', viewHTML.includes('参加这个活动'));

  // 4. 用 api 取详情数据，验证结构（detail.activity/me/participants）
  const det = await window.api('/api/activities/' + aid);
  ok('详情接口含 activity', !!(det && det.activity && det.activity.id === aid));
  ok('详情接口含 participants 数组', Array.isArray(det.participants));
  ok('未参加时 me 为 null', det.me === null);

  // 5. 参加（UI 函数）
  await window.joinAct(aid);
  await wait(120);
  const det2 = await window.api('/api/activities/' + aid);
  ok('参加后 me 存在', !!det2.me);
  ok('参加后 me.feePaid=true', det2.me.feePaid === true);

  // 6. 签到（UI：openCheckin -> 勾选 -> confirmCheckin）
  await window.openCheckin(aid);
  await wait(60);
  const cb = document.getElementById('taskDone'); if (cb) cb.checked = true;
  await window.confirmCheckin();
  await wait(120);
  const det3 = await window.api('/api/activities/' + aid);
  ok('签到后 todaySigned=true', det3.me.todaySigned === true);
  ok('签到后 canCheckin=false', det3.me.canCheckin === false);

  // 7. 重复签到被拦截（UI confirmCheckin 二次）
  await window.openCheckin(aid); await wait(40);
  const cb2 = document.getElementById('taskDone'); if (cb2) cb2.checked = true;
  const prev = det3.me.score;
  await window.confirmCheckin(); // 今日已签，应 toast 报错但不抛异常
  await wait(80);
  const det4 = await window.api('/api/activities/' + aid);
  ok('重复签到记分不变', det4.me.score === prev, `score=${det4.me.score}`);

  // 7.5 举办人发放补签卡（UI 流程：当前用户是活动创建者）
  await window.showDetail(aid); await wait(120);
  let vh2 = document.getElementById('view').innerHTML;
  ok('举办人可见「发放补签卡」面板', vh2.includes('发放补签卡'));
  ok('发放面板含「发 1 张」按钮', vh2.includes('onclick="grantCard('));
  // 点击「发 1 张」-> 调用 grantCard -> 该参与者 cardsHeld +1
  const detM = await window.api('/api/activities/' + aid);
  const meP = detM.participants.find(p => p.isMe) || detM.participants[0];
  const beforeCards = meP ? meP.cardsHeld : 0;
  await window.grantCard(aid, meP.uid);
  await wait(180);
  const detM2 = await window.api('/api/activities/' + aid);
  const afterCards = detM2.participants.find(p => p.uid === meP.uid).cardsHeld;
  ok('发1张后该参与者 cardsHeld+1', afterCards === beforeCards + 1, `before=${beforeCards} after=${afterCards}`);

  // 8. 退出活动（UI 流程：详情页应有「退出活动」按钮 -> 点击弹确认 -> 确认后退出）
  await window.showDetail(aid); await wait(120);
  let vh = document.getElementById('view').innerHTML;
  ok('详情页渲染出「退出」按钮(已参加)', vh.includes('退出'));
  ok('退出按钮调用 leaveAct', vh.includes('onclick="leaveAct('));

  // 点击退出 -> 弹确认 modal
  await window.leaveAct(aid); await wait(80);
  const modal = document.querySelector('.modal-bg');
  ok('点击退出弹出确认 modal', !!modal && (modal.textContent || '').includes('退出'));
  ok('确认框含「确定退出」按钮', !!(modal && modal.innerHTML.includes('confirmLeave')));

  // 确认退出 -> 调用接口 -> 刷新详情（me 变 null，显示「参加这个活动」）
  await window.confirmLeave(aid); await wait(150);
  const det5 = await window.api('/api/activities/' + aid);
  ok('确认退出后 me 为 null', det5.me === null);
  vh = document.getElementById('view').innerHTML;
  ok('退出后详情页恢复「参加这个活动」按钮', vh.includes('参加这个活动'));
  ok('退出后详情页不再显示「退出」按钮', !vh.includes('退出'));

  // 9. 举办人删除活动（UI 流程）
  const created2 = await window.api('/api/activities', { method: 'POST', body: act });
  const aid2 = created2.id;
  await window.showDetail(aid2); await wait(120);
  let vh3 = document.getElementById('view').innerHTML;
  ok('举办人可见「删除活动」按钮', vh3.includes('删除活动'));
  ok('删除按钮调用 deleteAct', vh3.includes('onclick="deleteAct('));
  // 点击删除 -> 弹确认 modal
  await window.deleteAct(aid2); await wait(80);
  const modal2 = document.querySelector('.modal-bg');
  ok('点击删除弹出确认 modal', !!modal2 && (modal2.textContent || '').includes('删除'));
  ok('确认框含「确定删除」按钮', !!(modal2 && modal2.innerHTML.includes('confirmDelete')));
  // 确认删除 -> 调用接口 -> 跳回列表
  await window.confirmDelete(aid2); await wait(200);
  // 删除后活动不存在：详情接口应抛「不存在」错误
  let deleted = false;
  try { await window.api('/api/activities/' + aid2); } catch (e) { deleted = /不存在/.test(e.message); }
  ok('确认删除后 活动已不存在(详情接口报错)', deleted);
  // 列表不应含该活动
  const list2 = await window.api('/api/activities');
  ok('确认删除后 列表不含该活动', Array.isArray(list2) && !list2.some(x => x.id === aid2));

  console.log(`\n=== 前端集成测试：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
