# 腾讯云轻量应用服务器 部署指南

> 适用场景：朋友一起签到打卡（Node + Express + 内置 SQLite），需要「国内朋友能打开 + 有后端 + 数据持久 + 短期免费」。
> 腾讯云轻量应用服务器（Lighthouse）是新用户 **1 个月免费试用** 的标准 VPS，完美满足以上条件，且**代码零改动**（直接 `git clone` 跑）。

---

## 一、为什么选腾讯云轻量应用服务器

| 条件 | 是否满足 | 说明 |
|---|---|---|
| 国内朋友能打开 | ✅ | 腾讯云大陆节点，武汉微信里秒开 |
| 能跑后端 + SQLite | ✅ | 标准 VPS，磁盘持久，node:sqlite 直接写文件 |
| 数据持久 | ✅ | 系统盘 40GB 持久，重启/关机都不丢 |
| 免费（短期） | ✅ | 个人认证 **2核2G / 3M / 40GB / 200G流量包 / 1个月** |
| 代码改动 | 不改 | 复用 `npm start`（自带 `--experimental-sqlite`），无需改入口/绕 flag |

> 之前试过的海外平台（Serv00 国内打不开、Vercel/Cloudflare 被墙、GitHub Pages 没后端）全部排除，核心矛盾是"海外平台被大陆网络阻断"。腾讯云是国内大厂，天然没有这个问题。

---

## 二、你本人要做的（我进不去你的腾讯云账号）

### 1. 注册 + 实名认证
- 打开 https://cloud.tencent.com → 微信扫码注册。
- **个人实名认证**（必须，国内云都要求）：上传身份证，几分钟内过。

### 2. 领取免费试用
- 进入 https://cloud.tencent.com/act/free → 找到「轻量应用服务器」→ 个人认证档 **2核2G 1个月** → 立即试用。
- 地域选离你近的（如「上海」或「广州」），不影响朋友访问。
- 镜像选 **Ubuntu 22.04 LTS**（或 Debian 12，二选一）。
- 实例名随意，带宽选默认的 3Mbps 即可（200G 流量包够几个朋友用一个月）。
- 提交后等 1~2 分钟，实例出现在「轻量应用服务器」控制台。

### 3. 拿到三样信息（后面要用）
- **公网 IP**（控制台实例详情页，形如 `1.2.3.4`）
- **登录用户名**：Ubuntu 镜像默认 `ubuntu`
- **登录方式**：设置 root 密码（控制台 → 更多 → 重置密码），或用 SSH 密钥。

### 4. 放行防火墙（关键，漏了外网打不开）
- 控制台 → 你的实例 → **防火墙** → 添加规则：
  - 应用类型：自定义
  - 协议：TCP
  - 端口：3000
  - 策略：允许
  - 来源：全部（或留空）
- 保存。这一步**服务器内的 ufw 放行不够，必须在控制台做**。

---

## 三、我帮你做 / 你执行的部署

### 方式 A：一键脚本（最省事，推荐）
在你**本机终端**（Windows 用 PowerShell 或 Git Bash）SSH 进服务器：
```bash
ssh ubuntu@<你的公网IP>
```
输入密码登录后，**把项目里 `deploy-tencent.sh` 的内容整段粘贴**到终端，回车。脚本会自动：
1. 装 Node.js 22
2. 装 pm2 进程守护
3. `git clone` 公开仓库
4. `npm install`
5. 写 `.env`（含 JWT_SECRET / PORT）
6. 放行本地 3000 端口
7. `pm2 start` 启动服务

跑完最后会打印访问地址。

### 方式 B：手动分步（想看每一步在干嘛）
```bash
# 1. 装 Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update && sudo apt-get install -y nodejs git

# 2. 装 pm2
sudo npm install -g pm2

# 3. 拉代码
git clone https://github.com/dongsiyu98/signin-app.git ~/signin-app
cd ~/signin-app && npm install

# 4. 写配置
echo "JWT_SECRET=***REMOVED***" > .env
echo "PORT=3000" >> .env

# 5. 启动
pm2 start npm --name signin -- start
pm2 save
```

---

## 四、验证（你 + 朋友）

1. 浏览器开 `http://<公网IP>:3000`，注册 / 登录 / 发布「作家签到」/ 签到，跑通主流程。
2. 两个设备（你 + 朋友）实测实时同步、排名正确。
3. 微信发链接给朋友：会弹"外部链接"确认框，点继续即可打开；教朋友"右上角 → 添加到主屏幕"伪装成 App。

> 关于 HTTPS：免费试用仅 1 个月，不满足备案"包月≥3个月"要求，所以**先直接用 `http://IP:3000`**，无需域名、无需备案、无需证书。若正式续费，再搞域名 + 备案 + 免费 SSL 证书实现 HTTPS（微信里不再弹确认框）。

---

## 五、运维与迭代（长期）

- **改代码上线**：本地 `git commit && git push` → SSH 进服务器 `cd ~/signin-app && git pull && pm2 restart signin`。
- **备份数据**：SSH 进服务器跑 `cd ~/signin-app && node backup-db.js backup`，再把 `backups/` 目录 scp 下载到本地（防平台跑路/到期）。
- **查看状态**：`pm2 status` / `pm2 logs signin`。
- **一个月到期**：
  - 想续费：轻量应用服务器 2核2G 约几十元/年，很便宜；
  - 不想续费：把 `signin.db` 备份好，换任意能跑 Node 的 VPS 重跑（`deploy-tencent.sh` 通用），**零锁定、零迁移成本**。

---

## 附录：仓库可见性说明

部署用 `git clone` 公开仓库地址。已把 `dongsiyu98/signin-app` 设为**公开**——代码不含任何密钥（`.env` 不入库）和个人数据（`signin.db` 不入库），公开风险极低。

若你希望保持私有：
1. GitHub 网页把仓库改回 Private；
2. 在仓库 **Settings → Deploy keys** 添加服务器 SSH 公钥（服务器上 `ssh-keygen` 生成，`cat ~/.ssh/id_rsa.pub`）；
3. 把 `deploy-tencent.sh` 里的 `REPO` 改成 SSH 地址 `git@github.com:dongsiyu98/signin-app.git`。
