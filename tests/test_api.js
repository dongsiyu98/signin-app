// API 集成测试（HTTP 全链路，带断言）。需要服务器已运行在 process.env.PORT（默认 3000）。
// 运行：node --experimental-sqlite tests/test_api.js   （配合 tests/test_all.js 会自动起服务）
const BASE = 'http://localhost:' + (process.env.PORT || 3000);

// 安全护栏：禁止测试脚本直连生产端口(3000)，以免污染生产数据库
if (!process.env.RUN_VIA_TESTALL && (process.env.PORT || 3000) === 3000) {
  console.error('⛔ 安全拦截：测试脚本禁止直连生产端口(3000)，以免污染生产数据库。');
  console.error('   请通过 `npm test`（自动使用隔离测试库 test_signin.db :3001）运行；');
  console.error('   手动调试请指定非 3000 端口，例如：PORT=3001 node --experimental-sqlite tests/test_api.js');
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
}
const ok2xx = s => s >= 200 && s < 300;

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
  name: '作家签到·API测试', icon: '✍️', description: '集成测试自动创建', cycleDays: 30, fee: 25, refundRealDays: 5,
  taskReq: '完成1小时小说', tiers: [{ day: 5, per: 5 }, { day: 10, per: 10 }, { day: 20, per: 15 }, { day: 30, per: 20 }],
  milestones: [{ day: 5, add: 25 }, { day: 10, add: 50 }, { day: 20, add: 150 }, { day: 30, add: 200 }],
  cardDays: [7, 14, 21, 28], labels: { score: '奖金', fee: '参与金', feeRefund: '已退参与金', poolAdd: '奖池加注', card: '补签卡' }
};

(async () => {
  // 幂等获取 token：注册失败（昵称已存在）则走登录
  async function auth(nickname) {
    let r = await call('POST', '/api/auth/register', null, { nickname, password: '1234' });
    if (r.status === 409) r = await call('POST', '/api/auth/login', null, { nickname, password: '1234' });
    return { r, token: r.data && r.data.token };
  }
  const a = await auth('小明');
  check('注册/登录 小明 返回 token', !!a.token, 'HTTP ' + a.r.status);
  const b = await auth('小红');
  check('注册/登录 小红 返回 token', !!b.token);
  const tokA = a.token, tokB = b.token;

  // 鉴权
  let r = await call('GET', '/api/me', tokA);
  check('me 返回昵称=小明', r.data && r.data.user && r.data.user.nickname === '小明', JSON.stringify(r.data));
  r = await call('GET', '/api/me', null);
  check('未带 token 访问受保护接口 -> 401', r.status === 401, 'HTTP ' + r.status);

  // 创建活动（成功返回 2xx + {id}）
  r = await call('POST', '/api/activities', tokA, ACT);
  check('创建活动 -> 成功(2xx)', ok2xx(r.status), 'HTTP ' + r.status);
  const aid = r.data && r.data.id;
  check('创建活动返回 id', !!aid, 'id=' + aid);

  // 列表
  r = await call('GET', '/api/activities', null);
  check('活动列表含新建活动', Array.isArray(r.data) && r.data.some(x => x.id === aid));

  // 参加 / 重复参加
  r = await call('POST', `/api/activities/${aid}/join`, tokB, { paid: true });
  check('小红参加 -> 成功(2xx)', ok2xx(r.status), 'HTTP ' + r.status);
  r = await call('POST', `/api/activities/${aid}/join`, tokA, { paid: true });
  check('小明参加 -> 成功(2xx)', ok2xx(r.status));
  r = await call('POST', `/api/activities/${aid}/join`, tokA, { paid: true });
  check('小明重复参加 -> 409', r.status === 409, 'HTTP ' + r.status);

  // ===== 举办人发放补签卡 =====
  // creator = 小明(tokA)。取参与者小红的 uid
  let det = await call('GET', `/api/activities/${aid}`, tokA);
  const xh = det.data && det.data.participants && det.data.participants.find(p => p.nickname === '小红');
  check('能取到参与者小红 uid', !!(xh && xh.uid), 'uid=' + (xh && xh.uid));
  const before = xh ? xh.cardsHeld : 0;
  // 举办人给小红发1张 -> 200，cardsHeld+1
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokA, { userId: xh.uid, count: 1 });
  check('举办人发补签卡 -> 200', ok2xx(r.status), 'HTTP ' + r.status);
  check('发放1张后 cardsHeld+1', r.data && r.data.cardsHeld === before + 1, 'cardsHeld=' + (r.data && r.data.cardsHeld));
  // 再发2张 -> cardsHeld+3
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokA, { userId: xh.uid, count: 2 });
  check('再发2张后 cardsHeld+3', r.data && r.data.cardsHeld === before + 3, 'cardsHeld=' + (r.data && r.data.cardsHeld));
  // 非举办人(小红)发放 -> 403
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokB, { userId: xh.uid, count: 1 });
  check('非举办人发放 -> 403', r.status === 403, 'HTTP ' + r.status);
  // 给未参加用户发放 -> 400
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokA, { userId: 'no_such_user_123', count: 1 });
  check('给未参加用户发放 -> 400', r.status === 400, 'HTTP ' + r.status);
  // 数量非法 -> 400
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokA, { userId: xh.uid, count: 0 });
  check('发放数量=0 -> 400', r.status === 400, 'HTTP ' + r.status);
  r = await call('POST', `/api/activities/${aid}/grant-card`, tokA, { userId: xh.uid, count: 'abc' });
  check('发放数量非数字 -> 400', r.status === 400, 'HTTP ' + r.status);

  // 未授权创建活动
  r = await call('POST', '/api/activities', null, ACT);
  check('未授权创建活动 -> 401', r.status === 401, 'HTTP ' + r.status);

  // 签到 / 重复签到
  r = await call('POST', `/api/activities/${aid}/checkin`, tokA, { taskDone: true });
  check('小明签到 -> 成功(2xx)', ok2xx(r.status));
  r = await call('POST', `/api/activities/${aid}/checkin`, tokA, { taskDone: true });
  check('小明重复签到 -> 409', r.status === 409, 'HTTP ' + r.status);

  // 补签：今日已签且无卡 -> 服务端拒绝(4xx)。此处验证补签接口的防守
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  r = await call('POST', `/api/activities/${aid}/makeup`, tokA, { date: todayStr });
  check('小明补签被拒(4xx：今日已签且无卡)', r.status >= 400 && r.status < 500, 'HTTP ' + r.status);

  // 详情字段
  r = await call('GET', `/api/activities/${aid}`, tokA);
  check('活动详情 me 存在', !!(r.data && r.data.me));
  check('详情 todaySigned=true', r.data && r.data.me && r.data.me.todaySigned === true);
  check('详情 canCheckin=false', r.data && r.data.me && r.data.me.canCheckin === false);
  check('详情 score 为数字(签1天未达门槛应为0)', r.data && r.data.me && typeof r.data.me.score === 'number' && r.data.me.score === 0, 'score=' + (r.data && r.data.me && r.data.me.score));

  // 我的活动：结构为 [{ activity, state }]
  r = await call('GET', '/api/me/activities', tokA);
  check('我的活动包含该活动', Array.isArray(r.data) && r.data.some(x => x.activity && x.activity.id === aid));

  // ===== 退出活动 =====
  // 退出前确认小明已在参与且已有签到
  r = await call('GET', `/api/activities/${aid}`, tokA);
  check('退出前 小明 me 存在且有签到', r.data && r.data.me && r.data.me.todaySigned === true);

  // 未参加的用户退出 -> 400
  const c = await auth('阿强_退出测试');
  r = await call('POST', `/api/activities/${aid}/leave`, c.token);
  check('未参加用户退出 -> 400', r.status === 400, 'HTTP ' + r.status);

  // 活动不存在 -> 404
  r = await call('POST', `/api/activities/nonexist_id/leave`, tokA);
  check('退出不存在活动 -> 404', r.status === 404, 'HTTP ' + r.status);

  // 正常退出 -> 2xx + {ok:true}
  r = await call('POST', `/api/activities/${aid}/leave`, tokA);
  check('小明退出活动 -> 成功(2xx)', ok2xx(r.status), 'HTTP ' + r.status);
  check('退出响应 ok=true', r.data && r.data.ok === true);

  // 退出后：我的活动不含该活动
  r = await call('GET', '/api/me/activities', tokA);
  check('退出后 我的活动不含该活动', Array.isArray(r.data) && !r.data.some(x => x.activity && x.activity.id === aid));

  // 退出后：详情 me 为 null（恢复成「参加这个活动」状态）
  r = await call('GET', `/api/activities/${aid}`, tokA);
  check('退出后 详情 me 为 null', r.data && r.data.me === null);

  // 退出后：签到记录已被清空（重新参加再签到，score 应重新从0起算而非保留）
  await call('POST', `/api/activities/${aid}/join`, tokA, { paid: true });
  r = await call('POST', `/api/activities/${aid}/checkin`, tokA, { taskDone: true });
  check('退出再参加后重新签到 -> 成功(2xx)', ok2xx(r.status));
  check('退出再参加后 score 仍为0（旧签到已清空）', r.data && r.data.state && r.data.state.score === 0, 'score=' + (r.data && r.data.state && r.data.state.score));

  // 重复退出 -> 400
  await call('POST', `/api/activities/${aid}/leave`, tokA); // 先退出
  r = await call('POST', `/api/activities/${aid}/leave`, tokA);
  check('重复退出 -> 400', r.status === 400, 'HTTP ' + r.status);

  console.log(`\n=== API 集成测试：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
