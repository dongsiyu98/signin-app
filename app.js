/**
 * Serv00 (Phusion Passenger) 兼容入口
 * ------------------------------------------------------------
 * Serv00 用 Phusion Passenger 托管 Node 应用，默认在
 *   ~/domains/<DOMAIN>/public_nodejs/app.js
 * 查找入口文件。本文件仅把真正的服务入口转发出去。
 *
 * 重要：node:sqlite 需要的 --experimental-sqlite flag 由 Serv00 上
 *   ~/.bash_profile 中的  export NODE_OPTIONS=--experimental-sqlite
 * 在 Passenger 启动应用时自动带上（详见 SERV00_DEPLOY.md）。
 */
'use strict';
require('./server.js');
