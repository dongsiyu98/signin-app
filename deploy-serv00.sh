#!/bin/bash
# ============================================================
# 签到功能 · Serv00 一键部署脚本
# ------------------------------------------------------------
# 在 Serv00 的 SSH 终端里执行本脚本（不是你本机！）
# 前提：
#   1. 已在 serv00.com 注册并通过邮件拿到 服务器地址 / SSH端口 / 用户名
#   2. 已在 Serv00 面板创建「类型为 nodejs」的 WWW 网站（域名即 LOGIN.serv00.net）
#   3. GitHub 仓库 dongsiyu98/signin-app 已设为「公开」（最简单），
#      或用 deploy key（见 SERV00_DEPLOY.md 的私有仓库方案）
# ============================================================
set -e

# ↓↓↓ 只改这一行：填你的 Serv00 用户名（注册邮件里有） ↓↓↓
LOGIN="改成你的用户名"
# ↑↑↑ ↑↑↑ ↑↑↑

DOMAIN="${LOGIN}.serv00.net"
APP_DIR=~/domains/${DOMAIN}/public_nodejs

echo ">>> [1/6] 配置 node:sqlite 与 JWT 密钥（写入 ~/.bash_profile，Passenger 会自动读取）"
grep -q 'NODE_OPTIONS=--experimental-sqlite' ~/.bash_profile 2>/dev/null \
  || echo 'export NODE_OPTIONS=--experimental-sqlite' >> ~/.bash_profile
grep -q 'JWT_SECRET=' ~/.bash_profile 2>/dev/null \
  || echo 'export JWT_SECRET=***REMOVED***' >> ~/.bash_profile
source ~/.bash_profile

echo ">>> [2/6] 进入应用目录并清理默认占位文件"
mkdir -p "${APP_DIR}"
cd "${APP_DIR}"
rm -f app.js public/index.html 2>/dev/null || true

echo ">>> [3/6] 从 GitHub 拉取代码"
rm -rf _deploy_tmp
git clone --depth 1 https://github.com/dongsiyu98/signin-app.git _deploy_tmp
shopt -s dotglob
mv _deploy_tmp/* "${APP_DIR}/" 2>/dev/null || true
shopt -u dotglob
rm -rf _deploy_tmp

echo ">>> [4/6] 安装依赖"
npm install

echo ">>> [5/6] 重启 Node 应用（Passenger 会自动重新加载）"
devil www restart "${DOMAIN}" || true

echo ">>> [6/6] 完成！"
echo "访问地址： https://${DOMAIN}"
echo "若打不开，看日志： ~/domains/${DOMAIN}/logs/error.log"
