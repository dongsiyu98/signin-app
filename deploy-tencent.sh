#!/usr/bin/env bash
# ============================================================
# 腾讯云轻量应用服务器 一键部署脚本（Ubuntu / Debian）
# 用法：SSH 进服务器后，把本文件整段粘贴到终端执行
#       或 scp 上去后 `bash deploy-tencent.sh` 运行
# 前置：已在腾讯云领到轻量应用服务器（建议 Ubuntu 22.04），并拿到公网 IP
# ============================================================
set -e

REPO="https://github.com/dongsiyu98/signin-app.git"
APP_DIR="$HOME/signin-app"
# JWT_SECRET 用作密码哈希盐：请通过环境变量传入，未设置则自动生成随机值（切勿写死明文）
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

echo "== 1. 安装 Node.js 22（node:sqlite 需要 >=22.5）=="
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get update
sudo apt-get install -y nodejs git
node -v   # 应输出 v22.x

echo "== 2. 安装 pm2 进程守护（让服务掉线自动拉起）=="
sudo npm install -g pm2

echo "== 3. 拉取代码 =="
rm -rf "$APP_DIR"
git clone "$REPO" "$APP_DIR"
cd "$APP_DIR"

echo "== 4. 安装依赖 =="
npm install

echo "== 5. 写入运行配置 .env =="
cat > .env <<EOF
JWT_SECRET=$JWT_SECRET
PORT=3000
EOF

echo "== 6. 放行服务器本地防火墙 3000 端口 =="
sudo ufw allow 3000/tcp 2>/dev/null || echo "(ufw 未启用，跳过；请在腾讯云控制台防火墙放行 3000)"

echo "== 7. 启动服务（pm2 守护，复用 npm start 自带 --experimental-sqlite）=="
pm2 start npm --name signin -- start
pm2 save

echo "== 完成 =="
echo "访问地址： http://<你的公网IP>:3000"
echo "【重要】还需在腾讯云控制台【防火墙】添加规则放行 TCP 3000 端口（入站）！"
echo "常用命令："
echo "  状态：  pm2 status"
echo "  重启：  pm2 restart signin"
echo "  停止：  pm2 stop signin"
echo "  日志：  pm2 logs signin"
echo "  更新代码后： cd ~/signin-app && git pull && pm2 restart signin"
