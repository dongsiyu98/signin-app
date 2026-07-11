#!/usr/bin/env node
// 一键备份/恢复 SQLite 数据库（signin.db），零依赖、跨平台
// 用法：
//   node backup-db.js backup            # 备份当前库到 backups/<时间戳>/
//   node backup-db.js list              # 列出已有备份
//   node backup-db.js restore <路径>    # 恢复指定备份（会先自动备份当前库，防覆盖）

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DB = path.join(ROOT, 'signin.db');
const BACKUP_DIR = path.join(ROOT, 'backups');

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

function doBackup(label) {
  if (!fs.existsSync(DB)) {
    console.error('⚠️ 未找到 signin.db，无法备份（服务可能还没启动过 / 尚无数据）。');
    process.exit(1);
  }
  const dir = label ? path.join(BACKUP_DIR, label) : path.join(BACKUP_DIR, ts());
  fs.mkdirSync(dir, { recursive: true });

  const main = copyIfExists(DB, path.join(dir, 'signin.db'));
  copyIfExists(path.join(ROOT, 'signin.db-wal'), path.join(dir, 'signin.db-wal'));
  copyIfExists(path.join(ROOT, 'signin.db-shm'), path.join(dir, 'signin.db-shm'));

  console.log(`✅ 已备份到： ${dir}`);
  console.log(`   主库 signin.db${main ? '' : '（缺失，服务可能未运行）'}`);
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('尚无备份。运行: node backup-db.js backup');
    return;
  }
  const dirs = fs.readdirSync(BACKUP_DIR).filter((n) => fs.statSync(path.join(BACKUP_DIR, n)).isDirectory());
  if (dirs.length === 0) {
    console.log('尚无备份。运行: node backup-db.js backup');
    return;
  }
  console.log('已有备份（新→旧）：');
  dirs.sort().reverse().forEach((d) => {
    const f = path.join(BACKUP_DIR, d, 'signin.db');
    const size = fs.existsSync(f) ? `${(fs.statSync(f).size / 1024).toFixed(1)} KB` : '空';
    console.log(`  ${d.padEnd(20)} ${size}`);
  });
}

function doRestore(arg) {
  if (!arg) {
    console.error('用法: node backup-db.js restore <备份目录或 signin.db 路径>');
    process.exit(1);
  }
  const p = path.resolve(ROOT, arg);
  const src = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'signin.db') : p;
  if (!fs.existsSync(src)) {
    console.error(`⚠️ 未找到备份文件: ${src}`);
    process.exit(1);
  }
  doBackup('pre-restore-' + ts());
  console.log('⚠️ 恢复将覆盖当前 signin.db。若服务正在运行，请先停止服务再继续。');
  fs.copyFileSync(src, DB);
  copyIfExists(path.join(path.dirname(src), 'signin.db-wal'), path.join(ROOT, 'signin.db-wal'));
  copyIfExists(path.join(path.dirname(src), 'signin.db-shm'), path.join(ROOT, 'signin.db-shm'));
  console.log(`✅ 已从 ${src} 恢复。`);
}

const cmd = process.argv[2] || 'backup';
if (cmd === 'backup') doBackup();
else if (cmd === 'list') listBackups();
else if (cmd === 'restore') doRestore(process.argv[3]);
else {
  console.error('未知命令。支持: backup | list | restore');
  process.exit(1);
}
