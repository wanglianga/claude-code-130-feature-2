#!/usr/bin/env bash
# 首次环境准备：下载免安装 MariaDB（若缺失）→ 启动 → 建库 → 装依赖 → 建表 → 写入种子数据
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="mariadb-10.11.19-linux-systemd-x86_64"
LOCAL="$ROOT/.local"
mkdir -p "$LOCAL"

if [ ! -x "$LOCAL/mariadb/bin/mariadbd" ]; then
  echo "▶ 下载免安装 MariaDB（约 340MB，阿里云镜像）"
  curl -fL "https://mirrors.aliyun.com/mariadb/mariadb-10.11.19/bintar-linux-systemd-x86_64/${VER}.tar.gz" -o "$LOCAL/mariadb.tar.gz"
  tar xzf "$LOCAL/mariadb.tar.gz" -C "$LOCAL"
  ln -sfn "$VER" "$LOCAL/mariadb"
fi

# 生成免 root 的 MariaDB 启停脚本（.local 为运行时目录，不入库）
cat > "$LOCAL/mysqlctl.sh" <<'CTL'
#!/usr/bin/env bash
# 用法：mysqlctl.sh start | stop | status
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MB="$ROOT/.local/mariadb"
DATA="$ROOT/.local/mysqldata"
SOCK="$ROOT/.local/mysql.sock"
PIDF="$ROOT/.local/mysqld.pid"
LOG="$ROOT/.local/mysqld.log"

running() { "$MB/bin/mariadb" -upetapp -ppetapp123 -h127.0.0.1 -e "SELECT 1" >/dev/null 2>&1; }

case "${1:-start}" in
  start)
    if running; then echo "MariaDB 已在运行（127.0.0.1:3306）"; exit 0; fi
    [ -d "$DATA/mysql" ] || "$MB/scripts/mariadb-install-db" --basedir="$MB" --datadir="$DATA" \
      --auth-root-authentication-method=normal --skip-test-db >/dev/null
    nohup "$MB/bin/mariadbd" --basedir="$MB" --datadir="$DATA" --socket="$SOCK" --pid-file="$PIDF" \
      --port=3306 --bind-address=127.0.0.1 --skip-networking=0 >"$LOG" 2>&1 &
    for _ in $(seq 1 30); do sleep 2; running && break; done
    "$MB/bin/mariadb" -uroot --socket="$SOCK" <<'SQL'
CREATE DATABASE IF NOT EXISTS pet_aftercare CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'petapp'@'%' IDENTIFIED BY 'petapp123';
CREATE USER IF NOT EXISTS 'petapp'@'localhost' IDENTIFIED BY 'petapp123';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'%';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'localhost';
FLUSH PRIVILEGES;
SQL
    echo "MariaDB 已启动：127.0.0.1:3306（petapp/petapp123，库 pet_aftercare）"
    ;;
  stop)
    "$MB/bin/mariadb-admin" -uroot --socket="$SOCK" shutdown 2>/dev/null && echo "MariaDB 已停止" || echo "未在运行"
    ;;
  status)
    if running; then echo "running: 127.0.0.1:3306"; else echo "stopped"; exit 1; fi
    ;;
  *) echo "用法：$0 start|stop|status"; exit 2 ;;
esac
CTL
chmod +x "$LOCAL/mysqlctl.sh"
"$LOCAL/mysqlctl.sh" start

echo "▶ 安装后端依赖并写入种子数据"
cd "$ROOT/backend"
[ -d node_modules ] || npm install --no-audit --no-fund
npm run seed

echo "▶ 安装前端依赖"
cd "$ROOT/frontend"
[ -d node_modules ] || npm install --no-audit --no-fund

echo "✅ 准备完成。运行 bash scripts/dev.sh 启动平台。"
