// 一键测试编排：自动起服务(测试库隔离) -> 跑规则 -> 跑 API -> 跑边界 -> (可选)跑前端 -> 关服务 -> 汇总
// 本文件位于 tests/ 目录。用法：node --experimental-sqlite tests/test_all.js
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const NODE = process.execPath;
const TEST_DIR = __dirname;                  // tests/ 目录
const APP_DIR = path.join(__dirname, '..');  // 应用根目录 signin-app/
const PORT = 3001; // 独立端口，避免与手动起的 3000 冲突
const TEST_DB = path.join(TEST_DIR, 'test_signin.db'); // 测试库放在 tests/ 内，不污染应用

function run(file, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(NODE, ['--experimental-sqlite', file], {
      cwd: APP_DIR,
      env: { ...process.env, RUN_VIA_TESTALL: '1', ...env }
    });
    p.stdout.on('data', d => process.stdout.write(d));
    p.stderr.on('data', d => process.stderr.write(d));
    p.on('close', code => resolve({ code: code || 0 }));
  });
}

function waitPort(url, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(url, res => { res.resume(); resolve(true); });
      req.on('error', () => {
        if (n <= 0) reject(new Error('server not up'));
        else setTimeout(() => attempt(n - 1), 300);
      });
    };
    attempt(tries);
  });
}

(async () => {
  // 清理上一轮测试库
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch (e) {}
  }

  console.log('\n========== 1/5 规则引擎单元测试 ==========');
  const r1 = await run(path.join(TEST_DIR, 'test_rules.js'));

  console.log('\n========== 2/5 启动服务器（测试库隔离）==========');
  const server = spawn(NODE, ['--experimental-sqlite', path.join(APP_DIR, 'server.js')], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(PORT), DB_PATH: TEST_DB, JWT_SECRET: 'test_secret' }
  });
  server.stdout.on('data', d => process.stdout.write('[server] ' + d));
  server.stderr.on('data', d => process.stderr.write('[server-err] ' + d));

  try {
    await waitPort(`http://localhost:${PORT}/api/activities`);
  } catch (e) {
    console.error('服务器启动失败，终止测试');
    server.kill();
    process.exit(1);
  }

  console.log('\n========== 3/5 API 集成测试 ==========');
  const r2 = await run(path.join(TEST_DIR, 'test_api.js'), { PORT: String(PORT) });

  console.log('\n========== 4/5 边界用例测试 ==========');
  const r3 = await run(path.join(TEST_DIR, 'test_boundary.js'), { PORT: String(PORT) });

  let r4 = { code: 99 };
  try {
    require.resolve('jsdom');
    console.log('\n========== 5/5 前端集成测试 ==========');
    r4 = await run(path.join(TEST_DIR, 'test_frontend.js'), { PORT: String(PORT) });
  } catch (e) {
    console.log('\n========== 5/5 前端集成测试（跳过：未安装 jsdom，运行 npm install --no-save jsdom 后启用）==========');
  }

  server.kill();

  const P = c => c === 99 ? 'SKIP' : (c ? 'FAIL' : 'PASS');
  console.log(`\n========== 汇总 ==========`);
  console.log(`  规则引擎 : ${P(r1.code)}`);
  console.log(`  API 集成 : ${P(r2.code)}`);
  console.log(`  边界用例 : ${P(r3.code)}`);
  console.log(`  前端集成 : ${P(r4.code)}`);
  const failed = (r1.code ? 1 : 0) + (r2.code ? 1 : 0) + (r3.code ? 1 : 0) + (r4.code && r4.code !== 99 ? 1 : 0);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('编排异常:', e); process.exit(1); });
