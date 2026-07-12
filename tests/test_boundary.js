// 边界用例测试（异常输入 / 防守分支），HTTP 全链路，带断言。
// 需服务器已运行在 process.env.PORT（默认 3000）。配合 tests/test_all.js 会自动起服务。
// 运行：node --experimental-sqlite tests/test_boundary.js
const BASE = 'http://localhost:' + (process.env.PORT || 3000);

// 安全护栏：禁止测试脚本直连生产端口(3000)，以免污染生产数据库
if (!process.env.RUN_VIA_TESTALL && (process.env.PORT || 3000) === 3000) {
  console.error('⛔ 安全拦截：测试脚本禁止直连生产端口(3000)，以免污染生产数据库。');
  console.error('   请通过 `npm test`（自动使用隔离测试库 test_signin.db :3001）运行；');
  console.error('   手动调试请指定非 3000 端口，例如：PORT=3001 node --experimental-sqlite tests/test_boundary.js');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}

async function call(method, p, token, body) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {}; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

const ACT = {
  name: '边界测试活动', icon: '🧪', description: '边界用例自动创建', cycleDays: 30, fee: 25, refundRealDays: 5,
  taskReq: '完成1小时小说', tiers: [{ day: 5, per: 5 }, { day: 10, per: 10 }, { day: 20, per: 15 }, { day: 30, per: 20 }],
  milestones: [{ day: 5, add: 25 }, { day: 10, add: 50 }, { day: 20, add: 150 }, { day: 30, add: 200 }],
  cardDays: [7, 14, 21, 28], labels: { score: '奖金', fee: '参与金', feeRefund: '已退参与金', poolAdd: '奖池加注', card: '补签卡' }
};

function localDate(offset) {
  const t = new Date();
  t.setDate(t.getDate() + offset);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

(async () => {
  const rnick = (p) => (p || 'B') + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const fakeId = 'nonexist_' + Date.now();
  const todayStr = localDate(0);
  const tomorrow = localDate(1);
  const yesterday = localDate(-1);
  let r;

  // 准备账号与活动
  async function auth(nickname) {
    let rr = await call('POST', '/api/auth/register', null, { nickname, password: '1234' });
    if (rr.status === 409) rr = await call('POST', '/api/auth/login', null, { nickname, password: '1234' });
    return { r: rr, token: rr.data && rr.data.token, nickname };
  }
  const creator = await auth(rnick('B主_'));
  const guest = await auth(rnick('B客_'));
  const tokA = creator.token, tokB = guest.token, N1 = creator.nickname;

  r = await call('POST', '/api/activities', tokA, ACT);
  const aid = r.data && r.data.id;
  check('边界活动创建成功', !!aid, 'HTTP ' + r.status);

  console.log('\n--- A. 账号/鉴权边界 ---');
  check('注册空昵称 -> 400', (r = await call('POST', '/api/auth/register', null, { nickname: '', password: '1234' })).status === 400, 'HTTP ' + r.status);
  check('注册昵称超长(>20字) -> 400', (r = await call('POST', '/api/auth/register', null, { nickname: '昵'.repeat(21), password: '1234' })).status === 400, 'HTTP ' + r.status);
  check('注册密码<4位 -> 400', (r = await call('POST', '/api/auth/register', null, { nickname: rnick('短密_'), password: '12' })).status === 400, 'HTTP ' + r.status);
  check('重复注册已存在昵称 -> 409', (r = await call('POST', '/api/auth/register', null, { nickname: N1, password: '1234' })).status === 409, 'HTTP ' + r.status);
  check('登录密码错误 -> 401', (r = await call('POST', '/api/auth/login', null, { nickname: N1, password: 'wrong' })).status === 401, 'HTTP ' + r.status);
  check('登录不存在用户 -> 401', (r = await call('POST', '/api/auth/login', null, { nickname: rnick('无_'), password: '1234' })).status === 401, 'HTTP ' + r.status);
  check('未授权创建活动 -> 401', (r = await call('POST', '/api/activities', null, ACT)).status === 401, 'HTTP ' + r.status);
  check('未授权参加活动 -> 401', (r = await call('POST', '/api/activities/' + aid + '/join', null, { paid: true })).status === 401, 'HTTP ' + r.status);

  console.log('\n--- B. 创建活动参数边界 ---');
  check('创建活动无名称 -> 400', (r = await call('POST', '/api/activities', tokA, { ...ACT, name: '' })).status === 400, 'HTTP ' + r.status);
  check('创建活动周期=0 -> 400', (r = await call('POST', '/api/activities', tokA, { ...ACT, cycleDays: 0 })).status === 400, 'HTTP ' + r.status);
  check('创建活动周期=999 -> 400', (r = await call('POST', '/api/activities', tokA, { ...ACT, cycleDays: 999 })).status === 400, 'HTTP ' + r.status);
  check('创建活动空档位 -> 400', (r = await call('POST', '/api/activities', tokA, { ...ACT, tiers: [] })).status === 400, 'HTTP ' + r.status);

  console.log('\n--- C. 资源不存在 404 ---');
  check('获取不存在活动 -> 404', (r = await call('GET', '/api/activities/' + fakeId, tokA)).status === 404, 'HTTP ' + r.status);
  check('参加不存在活动 -> 404', (r = await call('POST', '/api/activities/' + fakeId + '/join', tokA, { paid: true })).status === 404, 'HTTP ' + r.status);
  check('签到不存在活动 -> 404', (r = await call('POST', '/api/activities/' + fakeId + '/checkin', tokA, { taskDone: true })).status === 404, 'HTTP ' + r.status);
  check('补签不存在活动 -> 404', (r = await call('POST', '/api/activities/' + fakeId + '/makeup', tokA, { date: todayStr })).status === 404, 'HTTP ' + r.status);
  check('退出不存在活动 -> 404', (r = await call('POST', '/api/activities/' + fakeId + '/leave', tokA)).status === 404, 'HTTP ' + r.status);

  console.log('\n--- D. 未参加就操作 -> 400 ---');
  check('未参加就签到 -> 400', (r = await call('POST', '/api/activities/' + aid + '/checkin', tokB, { taskDone: true })).status === 400, 'HTTP ' + r.status);
  check('未参加就补签 -> 400', (r = await call('POST', '/api/activities/' + aid + '/makeup', tokB, { date: todayStr })).status === 400, 'HTTP ' + r.status);
  check('未参加就退出 -> 400', (r = await call('POST', '/api/activities/' + aid + '/leave', tokB)).status === 400, 'HTTP ' + r.status);

  console.log('\n--- E. 参加后防守分支（含重复/退出）---');
  check('客人参加 -> 200', (r = await call('POST', '/api/activities/' + aid + '/join', tokB, { paid: true })).status === 200, 'HTTP ' + r.status);
  check('重复参加 -> 409', (r = await call('POST', '/api/activities/' + aid + '/join', tokB, { paid: true })).status === 409, 'HTTP ' + r.status);
  check('补签未来日期 -> 400', (r = await call('POST', '/api/activities/' + aid + '/makeup', tokB, { date: tomorrow })).status === 400, 'HTTP ' + r.status);
  check('补签早于参加日 -> 400', (r = await call('POST', '/api/activities/' + aid + '/makeup', tokB, { date: yesterday })).status === 400, 'HTTP ' + r.status);
  check('补签日期格式错误 -> 400', (r = await call('POST', '/api/activities/' + aid + '/makeup', tokB, { date: '2026/13/40' })).status === 400, 'HTTP ' + r.status);
  check('客人签到 -> 200', (r = await call('POST', '/api/activities/' + aid + '/checkin', tokB, { taskDone: true })).status === 200, 'HTTP ' + r.status);
  check('重复签到 -> 409', (r = await call('POST', '/api/activities/' + aid + '/checkin', tokB, { taskDone: true })).status === 409, 'HTTP ' + r.status);
  check('当日已签到再补签 -> 409', (r = await call('POST', '/api/activities/' + aid + '/makeup', tokB, { date: todayStr })).status === 409, 'HTTP ' + r.status);
  check('退出已参加 -> 200', (r = await call('POST', '/api/activities/' + aid + '/leave', tokB)).status === 200, 'HTTP ' + r.status);
  check('退出后再退出 -> 400', (r = await call('POST', '/api/activities/' + aid + '/leave', tokB)).status === 400, 'HTTP ' + r.status);

  console.log('\n--- F. 举办人删除活动边界 ---');
  // 非举办人(客人)删除 -> 403
  check('非举办人(客人)删除 -> 403', (r = await call('DELETE', '/api/activities/' + aid, tokB)).status === 403, 'HTTP ' + r.status);
  // 删除不存在活动 -> 404
  check('删除不存在活动 -> 404', (r = await call('DELETE', '/api/activities/' + fakeId, tokA)).status === 404, 'HTTP ' + r.status);
  // 客人重新参加，便于验证级联清除
  r = await call('POST', '/api/activities/' + aid + '/join', tokB, { paid: true });
  check('客人重新参加 -> 200', r.status === 200, 'HTTP ' + r.status);
  // 举办人删除 -> 200
  check('举办人删除 -> 200', (r = await call('DELETE', '/api/activities/' + aid, tokA)).status === 200, 'HTTP ' + r.status);
  check('举办人删除后 详情 404', (r = await call('GET', '/api/activities/' + aid, tokA)).status === 404, 'HTTP ' + r.status);

  console.log(`\n=== 边界用例测试：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
