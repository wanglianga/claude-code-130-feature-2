#!/usr/bin/env bash
# 免 root 的本地 MariaDB 启停脚本（演示/开发用，数据在 .local/mysqldata）
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$DIR/mariadb"
DATA="${MYSQL_DATA_DIR:-$DIR/mysqldata}"
SOCK="${MYSQL_SOCK:-$DIR/mysql.sock}"
PIDF="$DIR/mysqld.pid"
PORT="${MYSQL_PORT:-3306}"

init_db() {
  "$BASE/scripts/mariadb-install-db" --basedir="$BASE" --datadir="$DATA" --auth-root-authentication-method=normal >/dev/null
  "$BASE/bin/mariadbd" --basedir="$BASE" --datadir="$DATA" --socket="$SOCK" --port="$PORT" --skip-networking=0 --bind-address=127.0.0.1 &
  local bp=$!
  for i in $(seq 1 60); do "$BASE/bin/mariadb" --socket="$SOCK" -u root -e 'SELECT 1' >/dev/null 2>&1 && break; sleep 1; done
  "$BASE/bin/mariadb" --socket="$SOCK" -u root <<SQL
CREATE DATABASE IF NOT EXISTS pet_aftercare CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'petapp'@'127.0.0.1' IDENTIFIED BY 'petapp123';
CREATE USER IF NOT EXISTS 'petapp'@'localhost' IDENTIFIED BY 'petapp123';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'127.0.0.1';
GRANT ALL PRIVILEGES ON pet_aftercare.* TO 'petapp'@'localhost';
FLUSH PRIVILEGES;
SQL
  kill "$bp" 2>/dev/null || true
  wait "$bp" 2>/dev/null || true
}

start() {
  [ -d "$DATA/mysql" ] || init_db
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "already running"; return; fi
  nohup "$BASE/bin/mariadbd" --basedir="$BASE" --datadir="$DATA" --socket="$SOCK" --port="$PORT" --bind-address=127.0.0.1 --pid-file="$PIDF" >"$DIR/mysqld.log" 2>&1 &
  for i in $(seq 1 60); do "$BASE/bin/mariadb" --socket="$SOCK" -u root -e 'SELECT 1' >/dev/null 2>&1 && { echo "started"; return; }; sleep 1; done
  echo "start failed"; tail "$DIR/mysqld.log"; exit 1
}
status() { if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "running pid $(cat "$PIDF")"; else echo "stopped"; fi; }
stop() { [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null || true; for i in $(seq 1 30); do kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null || break; sleep 1; done; rm -f "$PIDF"; echo stopped; }

case "${1:-start}" in start) start;; status) status;; stop) stop;; *) echo "usage: $0 start|stop|status";; esac
