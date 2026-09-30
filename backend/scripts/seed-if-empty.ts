/**
 * 仅在数据库为空（无门店）时播种，供容器首启自动初始化。
 * 已有数据时跳过，避免 docker 重启清空业务数据。
 */
import 'reflect-metadata';
import { seedIfEmpty } from './seed';

seedIfEmpty()
  .then(seeded => {
    console.log(seeded ? '空库已自动播种完成' : '无需播种');
    process.exit(0);
  })
  .catch(e => { console.error('自动播种失败:', e); process.exit(1); });
