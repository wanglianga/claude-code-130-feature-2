/**
 * 容器启动辅助：仅在 users 表为空时执行 seed（避免每次重启容器都清空业务数据）。
 * 运行：ts-node scripts/ensure-seed.ts（容器内也可用 node dist/scripts/ensure-seed.js）
 */
import 'reflect-metadata';
import { execFileSync } from 'child_process';
import mysql from 'mysql2/promise';

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'petapp',
    password: process.env.DB_PASS || 'petapp123',
    database: process.env.DB_NAME || 'pet_aftercare',
  });
  let seeded = true;
  try {
    const [rows] = await conn.query('SELECT COUNT(*) AS c FROM users') as any[];
    seeded = Number(rows[0].c) > 0;
  } catch {
    seeded = false; // 表尚未创建（TypeORM synchronize 未跑过）→ 需要 seed 建表
  } finally {
    await conn.end();
  }
  if (seeded) {
    console.log('已有业务数据，跳过 seed。');
    return;
  }
  console.log('数据库为空，执行初始化 seed…');
  const isCompiled = __filename.endsWith('.js');
  execFileSync(
    isCompiled ? 'node' : 'npx',
    isCompiled ? [`${__dirname}/seed.js`] : ['ts-node', `${__dirname}/seed.ts`],
    { stdio: 'inherit' },
  );
}

main().catch(e => { console.error(e); process.exit(1); });
