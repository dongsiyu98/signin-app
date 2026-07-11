# 签到打卡系统 · API 文档

> 配套后端：`signin-app/server.js`（Node + Express + SQLite）
> 本文件与实际代码一一对应，接口变更后请同步更新。

---

## 一、基础约定

| 项 | 说明 |
|---|---|
| 本地 Base URL | `http://localhost:3000` |
| 上云后 Base URL | 替换域名即可（如 `https://your-domain.com`），**代码零改动** |
| 请求/响应格式 | `application/json`（请求体 JSON，响应 JSON） |
| 字符编码 | UTF-8 |
| 日期格式 | `YYYY-MM-DD`（如 `2026-07-11`） |
| 时间格式 | ISO 8601 UTC（如 `2026-07-11T14:30:00.000Z`） |

### 鉴权
需要登录的接口，在请求头携带 Token：

```
Authorization: Bearer <token>
```

Token 由「注册」或「登录」接口返回，前端存入 `localStorage`。也可通过查询参数 `?token=` 或请求体 `token` 传递（兼容）。

### 统一响应结构
- **成功**：`HTTP 2xx`，业务数据直接作为 JSON 顶层字段返回（见各接口）。
- **失败**：`HTTP 4xx/5xx`，返回：
  ```json
  { "error": "错误描述" }
  ```

### 错误码汇总
| HTTP 状态码 | 含义 |
|---|---|
| 400 | 参数错误 / 业务规则拦截（不在周期内、重复签到、无补签卡等） |
| 401 | 未登录 / Token 失效 / 用户不存在 / 昵称或密码错误 |
| 404 | 资源不存在（活动不存在） |
| 409 | 冲突（昵称已占用、已参加活动、今日已签到、该日已签到） |
| 500 | 服务器内部错误 |

---

## 二、鉴权接口

### 2.1 注册
`POST /api/auth/register`

**请求体**
```json
{
  "nickname": "小明",
  "password": "1234"
}
```
| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| nickname | string | 是 | 1–20 字，全局唯一 |
| password | string | 是 | 至少 4 位 |

**成功响应** `200`
```json
{
  "token": "a1b2c3...（48位十六进制）",
  "user": { "id": "uid...", "nickname": "小明" }
}
```

**错误**
- `400` 昵称 1-20 字 / 密码至少 4 位
- `409` 昵称已被占用

---

### 2.2 登录
`POST /api/auth/login`

**请求体**
```json
{ "nickname": "小明", "password": "1234" }
```

**成功响应** `200`
```json
{ "token": "xxx", "user": { "id": "uid...", "nickname": "小明" } }
```

**错误**
- `401` 昵称或密码错误

---

### 2.3 退出登录
`POST /api/auth/logout`  🔒 需登录

**请求体**：无

**成功响应** `200`
```json
{ "ok": true }
```
> 服务器删除当前 Token 对应的 session，前端应同时清除本地 `token`。

---

### 2.4 获取当前用户
`GET /api/me`  🔒 需登录

**请求体**：无

**成功响应** `200`
```json
{ "user": { "id": "uid...", "nickname": "小明" } }
```

---

### 2.5 获取「我参加的活动」列表
`GET /api/me/activities`  🔒 需登录

**请求体**：无

**成功响应** `200` — 数组，按参加时间倒序
```json
[
  {
    "activity": { /* 见 §5.1 活动对象 */ },
    "state": { /* 见 §5.2 参与状态 State */ }
  }
]
```

---

## 三、活动接口

### 3.1 活动列表（全部）
`GET /api/activities`  🔓 公开

**请求体**：无

**成功响应** `200` — 数组，按创建时间倒序
```json
[
  {
    "id": "act...",
    "creatorId": "uid...",
    "creator": "秋香",
    "name": "作家签到",
    "description": "一个月作家签到活动",
    "cycleDays": 30,
    "fee": 25,
    "refundRealDays": 5,
    "taskReq": "每天完成至少1小时小说任务",
    "icon": "✍️",
    "tiers": [ { "day": 5, "per": 5 }, { "day": 10, "per": 10 }, { "day": 20, "per": 15 }, { "day": 30, "per": 20 } ],
    "milestones": [ { "day": 5, "add": 25 }, { "day": 10, "add": 50 }, { "day": 20, "add": 150 }, { "day": 30, "add": 200 } ],
    "cardDays": [ 7, 14, 21, 28 ],
    "labels": { "score": "奖金", "fee": "参与金", "feeRefund": "已退参与金", "poolAdd": "奖池加注", "card": "补签卡" },
    "createdAt": "2026-07-11T00:00:00.000Z",
    "participantCount": 4
  }
]
```

> 说明：`fee`/`refundRealDays` 为 0 时表示无参与金（如「早起打卡」）。

---

### 3.2 发布活动
`POST /api/activities`  🔒 需登录

**请求体**
| 字段 | 类型 | 必填 | 约束 / 说明 |
|---|---|---|---|
| name | string | 是 | 活动名称，非空 |
| cycleDays | int | 是 | 周期天数，1–366 |
| fee | int | 否 | 参与金（记分单位），默认 0 |
| refundRealDays | int | 否 | 累计真实签到满此天数退还参与金，默认 0 |
| tiers | array | 是 | 奖金档位 `[{day, per}]`，至少 1 项 |
| milestones | array | 否 | 奖池里程碑 `[{day, add}]` |
| cardDays | array | 否 | 补签卡发放日（周期内的第几天），`[int]` |
| taskReq | string | 否 | 每日任务要求文案 |
| icon | string | 否 | 活动图标 emoji，默认 📋 |
| description | string | 否 | 活动描述 |
| labels | object | 否 | 自定义文案标签，覆盖默认（见 §5.4） |

**tiers 字段语义**：`day` 表示「第 1 天到第 day 天」使用该档 `per`。多个档位按 `day` 升序，段内连续。例如作家签到四档：第 1–5 天每天 5、第 6–10 天每天 10、第 11–20 天每天 15、第 21–30 天每天 20。

**成功响应** `200`
```json
{ "id": "act_新活动ID" }
```

**错误**
- `400` 活动名称必填 / 周期天数 1-366 / 档位不能为空
- 档位会被服务端清洗（过滤 `day<=0` 或 `per<0`，并按 day 升序）

**完整示例（作家签到模板）**
```bash
curl -X POST http://localhost:3000/api/activities \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "作家签到",
    "description": "一个月作家签到活动",
    "cycleDays": 30,
    "fee": 25,
    "refundRealDays": 5,
    "taskReq": "每天完成至少1小时小说任务",
    "icon": "✍️",
    "tiers": [ {"day":5,"per":5}, {"day":10,"per":10}, {"day":20,"per":15}, {"day":30,"per":20} ],
    "milestones": [ {"day":5,"add":25}, {"day":10,"add":50}, {"day":20,"add":150}, {"day":30,"add":200} ],
    "cardDays": [7,14,21,28],
    "labels": { "score":"奖金", "fee":"参与金", "feeRefund":"已退参与金", "poolAdd":"奖池加注", "card":"补签卡" }
  }'
```

---

### 3.3 活动详情
`GET /api/activities/:id`  🔒 需登录

**路径参数**：`id` 活动 ID

**请求体**：无

**成功响应** `200`
```json
{
  "activity": { /* 见 §5.1，含 creator 字段 */ },
  "me": null | { /* 见 §5.2 仅当当前用户已参加才有值 */ },
  "participants": [
    {
      "uid": "uid...",
      "nickname": "小明",
      "curStreak": 12,
      "realDays": 12,
      "score": 95,
      "cardsHeld": 1,
      "refunded": false,
      "feePaid": true,
      "isMe": true
    }
  ]
}
```
> `participants` 按**记分降序**排列，即排名榜数据。`me` 为 `null` 表示你尚未参加。

---

## 四、签到相关接口

### 4.1 参加活动
`POST /api/activities/:id/join`  🔒 需登录

**路径参数**：`id` 活动 ID

**请求体**
```json
{ "paid": true }
```
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| paid | bool | 否 | 是否已缴参与金，默认 `true`。传 `false` 表示未缴（仍可按 fee=0 活动参加） |

**成功响应** `200`
```json
{ "ok": true }
```

**错误**
- `404` 活动不存在
- `409` 你已参加该活动

> 参加日 `join_date` = 服务器当天日期，作为周期起点与补签卡发放基准。

---

### 4.2 每日签到
`POST /api/activities/:id/checkin`  🔒 需登录

**路径参数**：`id` 活动 ID

**请求体**
```json
{ "taskDone": true }
```
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| taskDone | bool | 否 | 是否完成任务（如小说 1 小时），默认 `false` |

**成功响应** `200`
```json
{ "state": { /* 见 §5.2 最新参与状态 */ } }
```

**错误**
- `404` 活动不存在
- `400` 请先参加活动 / 不在活动周期内
- `409` 今天已签到

> 同一自然日重复签到会被拦截（按 `participation_id + date` 唯一约束）。

---

### 4.3 补签
`POST /api/activities/:id/makeup`  🔒 需登录

**路径参数**：`id` 活动 ID

**请求体**
```json
{ "date": "2026-07-08" }
```
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| date | string | 是 | 要补签的日期，`YYYY-MM-DD` 格式，必须在周期内且为过去日期 |

**成功响应** `200`
```json
{ "state": { /* 见 §5.2 最新参与状态（cardsHeld 已减 1） */ } }
```

**错误**
- `404` 活动不存在
- `400` 请先参加活动 / 日期格式错误 / 不在活动周期内 / 不能补未来的日期 / 没有可用的补签卡
- `409` 该日已签到

> 补签消耗 1 张补签卡（`cards_used + 1`，持有数 = 已发放 − 已用）。补签记录 `type='makeup'`，**不计入 `realDays`**（即不影响参与金退还判定）。前端会在补签前弹二次确认。

### 4.4 退出活动
`POST /api/activities/:id/leave`  🔒 需登录

**路径参数**：`id` 活动 ID

无请求体。

**成功响应** `200`
```json
{ "ok": true }
```

**错误**
- `404` 活动不存在
- `400` 你还没参加该活动

> 退出会**删除该参与记录及其全部签到记录**（真实签到、补签卡补签均清空），奖金、补签卡随之归零，且不可恢复。系统仅作记分，**不涉及真实款项退还**（参与金为线下私下转账，需你与发起人自行协商）。前端会在退出前弹二次确认。

### 4.5 举办人发放补签卡
`POST /api/activities/:id/grant-card`  🔒 需登录 · **仅活动举办人（creator）可调用**

**路径参数**：`id` 活动 ID

**请求体**
```json
{ "userId": "参与者用户ID", "count": 1 }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| userId | string | 是 | 被发放者的用户 ID（必须是本活动参与者） |
| count | integer | 是 | 发放数量，正整数，单次上限 50 |

**成功响应** `200`
```json
{ "ok": true, "userId": "参与者用户ID", "cardsBonus": 3, "cardsHeld": 3 }
```
- `cardsBonus`：该参与者累计被举办人补发的数量
- `cardsHeld`：该参与者当前持有的补签卡总数（`= 系统按 cardDays 自动发放 + cardsBonus − 已使用`）

**错误**
- `404` 活动不存在
- `403` 只有活动举办人才能发放补签卡（非举办人调用）
- `400` 该用户未参加本活动 / 发放数量须为正整数 / 单次发放不能超过 50 张

> 举办人补发与系统按 `cardDays`（第 7/14/21/28 天）自动发放**互不冲突**，各自独立累计，最终合并到持有数。纯记分，无真实成本。前端在活动详情页（仅举办人可见）提供「发放补签卡」面板，逐人点击「发 1 张」即可。

---

## 五、公共数据结构

### 5.1 活动对象 Activity
由 `arow()` 统一产出，所有活动相关接口返回的活动均为此结构：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 活动 ID |
| creatorId | string | 发布者用户 ID |
| creator | string | 发布者昵称（列表/详情接口附加） |
| name | string | 活动名称 |
| description | string | 描述 |
| cycleDays | int | 周期天数 |
| fee | int | 参与金（记分） |
| refundRealDays | int | 满此真实天数退参与金 |
| taskReq | string | 每日任务文案 |
| icon | string | 图标 emoji |
| tiers | array | 档位 `[{day, per}]` |
| milestones | array | 里程碑 `[{day, add}]` |
| cardDays | array | 补签卡发放日 `[int]` |
| labels | object | 文案标签（合并默认后） |
| createdAt | string | 创建时间 ISO |
| participantCount | int | 参与人数（仅列表接口） |

### 5.2 参与状态 State
由 `computeState()` **后端权威计算**返回，是排名、奖金、补签卡的唯一可信来源：

| 字段 | 类型 | 说明 |
|---|---|---|
| joined | bool | 是否已参加（恒 true） |
| joinDate | string | 参加日 `YYYY-MM-DD` |
| feePaid | bool | 是否已缴参与金 |
| curStreak | int | 当前连续签到天数（今天/昨天未签则归零） |
| realDays | int | 真实签到天数（不含补签卡） |
| score | int | 累计得分（按档位规则） |
| cardsHeld | int | 当前持有补签卡数 |
| cardsUsed | int | 已用补签卡数 |
| refunded | bool | 是否满足参与金退还条件 |
| todaySigned | bool | 今天是否已签到 |
| canCheckin | bool | 今天是否可签到（在周期内且未签） |
| inCycle | bool | 当前是否在活动周期内 |
| calendar | array | 日历数组（见下） |

**calendar 每一项**
```json
{ "idx": 1, "date": "2026-07-11", "state": "done", "taskDone": true }
```
`state` 取值：`done`(已真实签到) / `makeup`(补签) / `miss`(漏签) / `future`(未到)。

### 5.3 参与者排行对象 Participant
`GET /api/activities/:id` 的 `participants` 数组项：

| 字段 | 类型 | 说明 |
|---|---|---|
| uid | string | 用户 ID |
| nickname | string | 昵称 |
| curStreak | int | 连续天数 |
| realDays | int | 真实天数 |
| score | int | 得分 |
| cardsHeld | int | 持有补签卡 |
| refunded | bool | 是否已退参与金 |
| feePaid | bool | 是否已缴参与金 |
| isMe | bool | 是否为当前登录用户 |

### 5.4 默认文案标签 DEFAULT_LABELS
未自定义时生效，发布时可用 `labels` 覆盖：

```json
{ "score": "积分", "fee": "参与金", "feeRefund": "已退参与金", "poolAdd": "奖池加注", "card": "补签卡" }
```

---

## 六、规则引擎要点（后端计算口径）

以下逻辑全部在后端 `computeState()` 完成，前端只负责展示，**不可在前端自行计算**：

1. **连续天数**：以今天为基准，若今天已签从今天往前数；否则看昨天；断签即归零。
2. **记分**：按自然日顺序遍历，连续段内第 `k` 天按 `tiers` 对应档位加分；断签 `k` 归零重新计。作家签到满周期 = 5×5+10×5+15×10+20×10 = **425**。
3. **补签卡发放**：`cardDays` 中每个发放日 ≤ 今天即 +1；持有 = 已发放 − `cards_used`。
4. **参与金退还**：`fee > 0` 且 `realDays ≥ refundRealDays` 时 `refunded = true`（补签不计入 `realDays`）。
5. **周期边界**：以 `join_date` 为第 1 天，最后一天 = `join_date + cycleDays − 1`；超出范围签到/补签被拦截。

---

## 七、接口总览

| # | 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | 公开 | 注册 |
| 2 | POST | `/api/auth/login` | 公开 | 登录 |
| 3 | POST | `/api/auth/logout` | 登录 | 退出 |
| 4 | GET | `/api/me` | 登录 | 当前用户 |
| 5 | GET | `/api/me/activities` | 登录 | 我参加的活动 |
| 6 | GET | `/api/activities` | 公开 | 活动列表 |
| 7 | POST | `/api/activities` | 登录 | 发布活动 |
| 8 | GET | `/api/activities/:id` | 登录 | 活动详情（含排名） |
| 9 | POST | `/api/activities/:id/join` | 登录 | 参加活动 |
| 10 | POST | `/api/activities/:id/checkin` | 登录 | 每日签到 |
| 11 | POST | `/api/activities/:id/makeup` | 登录 | 补签 |
| 12 | POST | `/api/activities/:id/leave` | 登录 | 退出活动 |
| 13 | POST | `/api/activities/:id/grant-card` | 登录(举办人) | 举办人发放补签卡 |

> 所有未匹配上述路径的 `GET *` 一律返回前端 `index.html`（SPA 兜底）。
