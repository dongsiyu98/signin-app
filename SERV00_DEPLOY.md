# 签到功能 · 部署到 Serv00（免费、无需信用卡、持久存储）

> 适用：朋友一起签到打卡（Node + Express + 内置 node:sqlite）
> 平台：Serv00（serv00.com）—— 免费 3GB 持久盘，支持 Node v16/v18/v20/**v22(默认)**/v23/v24，SSH/SFTP 部署，域名 `LOGIN.serv00.net`（干净无横幅）。

---

## 〇、为什么选 Serv00（而不是 DOM Cloud）

DOM Cloud 免费计划要求 GitHub 账号注册满 6 个月 + 至少 1 个关注者，或填邀请码，或花 $4.5 升级。
你的 GitHub 账号（dongsiyu98）不满足，被卡住。Serv00 **完全免费、无需邀请码、无需信用卡、不玩信任验证**，是纯免费路线最稳的退路。

代价：部署比 DOM Cloud 更手动（需 SSH 进服务器跑命令），但本项目已备好**一键部署脚本**，你只需粘贴执行。

---

## 一、注册 Serv00（你做，约 5 分钟）

1. 打开 https://serv00.com/ 点 **Register**。
2. 填邮箱、设密码、选一个**服务器**（如 s1 / s2 …，随便选一个空闲的）。
3. 收验证邮件 → 激活。
4. 注册成功后，Serv00 会发一封**含登录信息**的邮件，记下三样：
   - **服务器地址**：如 `s1.serv00.com`
   - **SSH 端口**：通常为 `22`（有时给专用端口，以邮件为准）
   - **用户名（LOGIN）**：你的登录名
   - 免费域名即 `LOGIN.serv00.net`

---

## 二、在面板创建 Node.js 网站（你做）

1. 登录面板（邮件里的 `panelX.serv00.com`，X 是服务器编号）。
2. 进入 **WWW websites → Add new website**。
3. 域名填 `LOGIN.serv00.net`（LOGIN 换成你的用户名）。
4. **类型（Type）选 `nodejs`**（关键！不是 php/static）。
5. 保存。系统会生成 `~/domains/LOGIN.serv00.net/public_nodejs/` 目录（里面有默认 app.js / public/index.html，待会儿脚本会覆盖）。

---

## 三、把 GitHub 仓库设为「公开」（推荐，最省事）

部署脚本用 `git clone https://github.com/dongsiyu98/signin-app.git` 拉代码。
仓库现在是**私有**的，Serv00 直接 clone 会因无权限失败。

最简单：把仓库设为公开（本项目无密钥、无个人数据入库，公开风险极低）。
- GitHub 网页 → 进 `dongsiyu98/signin-app` → **Settings → 左侧最下方 Danger Zone → Change visibility → Make public**。

> 不想公开？用 deploy key（私有仓库方案，见文末附录）。

> 备注：这个仓库也可以由助手用你的 GitHub Token 直接改成公开，需要的话吱一声。

---

## 四、SSH 进服务器并跑一键脚本（你做，约 2 分钟）

### 4.1 连上 SSH
在你**本机**的终端（Windows 用 PowerShell / Git Bash）执行：
```bash
ssh -p <SSH端口> LOGIN@服务器地址
# 例： ssh -p 22 dongsiyu98@s1.serv00.com
```
首次连接输入 yes，再输 Serv00 密码（注册时设的）。出现 `$` 提示符即成功。

### 4.2 粘贴部署脚本
把仓库里的 `deploy-serv00.sh` 内容**整段复制**到 SSH 终端（先改第一行 `LOGIN="改成你的用户名"` 为你的真实用户名），回车执行。

脚本会自动：
1. 写入 `NODE_OPTIONS=--experimental-sqlite`（解决 node:sqlite 需要 flag 的问题）；
2. 写入 `JWT_SECRET`（应用令牌密钥，比代码里 dev 默认值安全）；
3. 进入 `public_nodejs` 目录，clone GitHub 代码；
4. `npm install` 装依赖；
5. `devil www restart` 重启应用。

看到 `访问地址： https://LOGIN.serv00.net` 即成功。

---

## 五、验证（你 + 朋友）

1. 浏览器开 `https://LOGIN.serv00.net`，注册/登录/发布「作家签到」/签到，跑通主流程。
2. 两个设备（你 + 朋友）实测实时同步、排名正确。
3. 微信发链接给朋友，教「右上角 → 添加到主屏幕」伪装 App。

---

## 六、运维与迭代

- **改代码上线**：在你本机 `git commit && git push` → 再 SSH 进 Serv00 跑一次脚本第 3~5 步（或重新执行整段脚本）即可更新。
- **备份数据**：定期在本机 `node backup-db.js backup` 留本地副本（防平台跑路/收费）。注意：SQLite 在云上，备份要从云上 `.db` 下载，或 SSH 进 Serv00 把 `~/domains/LOGIN.serv00.net/public_nodejs/signin.db` 拷回本地。
- **平台变卦**：下载 `.db` 备份，换任意能跑 Node 的地方重跑（Node + 单文件 SQLite 零锁定）。

---

## 附录 A：私有仓库方案（deploy key，不公开代码）

1. Serv00 的 SSH 里生成密钥：
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/serv00_github -N ""
   cat ~/.ssh/serv00_github.pub
   ```
2. 复制公钥，去 GitHub 仓库 **Settings → Deploy keys → Add deploy key**，粘贴，勾选 Allow write（可选，只读即可）。
3. 把 `deploy-serv00.sh` 里的 clone 地址改为 SSH 形式：
   ```bash
   git clone --depth 1 git@github.com:dongsiyu98/signin-app.git _deploy_tmp
   ```
4. 若 Serv00 的 git 默认用 https，可执行：
   ```bash
   git config --global url."git@github.com:".insteadOf "https://github.com/"
   ```

## 附录 B：Serv00 关键约束（务必知道）

- **24 小时无访问会自动休眠**，下次访问自动唤醒（首访略慢，正常现象，不影响数据）。
- **免费账户限制**：3GB 存储、512MB 内存、15 个系统进程、3 个 TCP/UDP 端口、3 个 Git 仓库——对「几个朋友 + 纯记分」绰绰有余。
- **端口**：Passenger 模式下**不要**自己 `listen` 固定端口，保持 `app.listen(process.env.PORT || 3000)`（server.js 已如此），Passenger 会接管。
- **NODE_OPTIONS**：`--experimental-sqlite` 通过 `~/.bash_profile` 注入，Passenger 启动应用时自动带上，无需改 server.js。
