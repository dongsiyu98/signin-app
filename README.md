# 签到打卡（真实前后端版）

和朋友一起发布签到活动、参加打卡、每日签到、看排名。数据集中存在服务器数据库，多人实时同步。

技术栈：**Node.js + Express + 内置 SQLite**（Node 22.5+ 自带的 `node:sqlite`，零原生依赖、无需编译，本地/云端都能跑）。

---

## 一、本地运行（先这样跑起来）

要求：已安装 **Node.js 22.5 以上**（内置 SQLite；用 `node -v` 查看版本）。

```bash
cd signin-app
cp .env.example .env      # 可选，默认即可
npm install
npm start
```

> `npm start` 已自动带上 `--experimental-sqlite` 参数启动；直接 `node server.js` 需要自己加该参数。

然后浏览器打开 **http://localhost:3000**

- 首次启动会自动创建 `signin.db` 数据库文件并建表
- 注册两个账号（用隐身窗口当第二个朋友），即可体验发布/参加/签到/排名

### 想快速看完 30 天流程？
编辑 `.env`，加一行（演示用，设成任意日期）：
```
SIMULATED_TODAY=2026-08-01
```
重启 `npm start`，全站按这个"今天"算，方便演示；**不设就用真实日期**（给朋友真实用时别设）。

---

## 二、给朋友用（局域网）

你本机 `npm start` 后，同一 WiFi 下的朋友用你的**局域网 IP** 访问：
```
http://你的内网IP:3000
```
查内网 IP：`ipconfig`（Windows）看「IPv4 地址」。

> 远程朋友（不同网络）要访问，需要你做端口映射 + 电脑常开，或走下面的"上云"。

---

## 三、上云（长期稳定、随时可访问）

同一份代码，原样放到云服务器即可，**业务代码几乎不改**：

1. 买一台云服务器（如腾讯云轻量应用服务器，几十元/年），装好 Node.js
2. 把整个 `signin-app` 目录传上去
3. 云服务器上 `npm install && npm start`
4. 改 `.env` 里的 `PORT` / `DB_PATH`（指到持久化目录，别放临时目录，否则重置丢数据）
5. 可选：用 nginx 反代 + 域名；或直接在云防火墙放行端口

SQLite 数据库文件 `signin.db` 跟着项目走，迁移时一起拷贝即可。

---

## 四、规则说明（系统只记分，不碰真实钱）

- **连续天数**：每天签到累加；断签（某天没签）连续天数归零、从头计
- **记分**：连续第 1–N 天按档位给分，档位越高每天分越多（断签重计）
- **参与金退还**：活动周期内累计「真实签到天数」达到阈值即退还（补签卡不计）
- **补签卡**：第 7/14/21/28 天各发 1 张，可补本周期任意漏签日，周期结束失效
- **奖池里程碑**：到达指定天数时显示累计加注（仅记分展示）

---

## 五、目录结构

```
signin-app/
  server.js        # 后端：Express + SQLite + 规则引擎 + API + 静态托管
  public/index.html# 前端 SPA（登录/活动/发布/详情/我的）
  package.json
  .env.example     # 配置样例（PORT / DB_PATH / JWT_SECRET / SIMULATED_TODAY）
  signin.db        # 运行时自动生成的数据库（勿提交）
```

## 六、API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register | 注册 {nickname,password} → {token,user} |
| POST | /api/auth/login | 登录 → {token,user} |
| GET | /api/me | 当前用户 |
| POST | /api/auth/logout | 退出 |
| GET | /api/activities | 活动列表（公开） |
| POST | /api/activities `[登录]` | 创建活动 |
| GET | /api/activities/:id `[登录]` | 详情 + 我的参与 + 排行榜 |
| GET | /api/me/activities `[登录]` | 我参加的活动与状态 |
| POST | /api/activities/:id/join `[登录]` | 参加 |
| POST | /api/activities/:id/checkin `[登录]` {taskDone} | 今日签到 |
| POST | /api/activities/:id/makeup `[登录]` {date} | 补签 |

> 📘 每个接口的**完整请求/响应结构、字段约束、错误码、curl 示例**见 → [API 文档](./API文档.md)

---

## 七、自测（可选）

仓库自带四套测试（位于 `tests/` 目录，与 APP 源码分离），验证后端与前端真实打通：

```bash
# 一键跑全套（自动起服务、用 tests/test_signin.db 隔离、跑完关服务、汇总）
npm test

# 或分别运行：
# 1) 规则引擎单元测试（纯函数，不需起服务）
node tests/test_rules.js

# 2) 后端 API 全链路（test_all 会自动起服务；单独跑需先 npm start）
node tests/test_api.js

# 3) 边界用例测试（异常/防守输入：401/400/404/409，需先起服务）
node tests/test_boundary.js

# 4) 前端集成测试（jsdom 加载页面 + 真实服务器）
npm install --no-save jsdom     # 仅测试需要，不写进 package.json
node tests/test_frontend.js
```

> 测试使用独立的 `tests/test_signin.db`，不会污染你的真实数据 `signin.db`；验证完可直接删除 `tests/test_signin.db`。

