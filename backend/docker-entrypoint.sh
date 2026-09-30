#!/bin/sh
# 后端容器入口：等待数据库 → 空库自动建表播种 → 启动服务
set -e

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-3306}"

echo "▶ 等待数据库 ${DB_HOST}:${DB_PORT} 就绪…"
node - "$DB_HOST" "$DB_PORT" <<'EOF'
const net = require('net');
const [host, port] = [process.argv[2], Number(process.argv[3])];
const deadline = Date.now() + 60000;
function tryOnce() {
  const sock = net.connect({ host, port });
  sock.on('connect', () => { sock.end(); process.exit(0); });
  sock.on('error', () => {
    if (Date.now() > deadline) { console.error('数据库连接超时'); process.exit(1); }
    setTimeout(tryOnce, 1000);
  });
}
tryOnce();
EOF

# 首启：表不存在会由 TypeORM synchronize 自动建立；仅空库写入演示数据
echo "▶ 检查并初始化种子数据（仅空库）…"
node dist/scripts/seed-if-empty.js || echo "（播种步骤跳过/失败，请查看日志）"

echo "▶ 启动后端服务（端口 4000）…"
exec node dist/src/main.js
