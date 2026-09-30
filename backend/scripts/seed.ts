/**
 * 种子数据：2 家门店、各角色账号、宠物医院转介、冷藏位/火化炉/告别室/柜位。
 * 运行：npm run seed
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Appointment, TimelineEvent } from '../src/entities/appointment';
import { Hospital, Store, User } from '../src/entities/core';
import {
  ColdStorage, FarewellRoomSlot, FurnaceSlot,
} from '../src/entities/ops';
import { Locker, MementoFailureCase } from '../src/entities/aftercare';
import { Message, Payment } from '../src/entities/billing';
import { hashPassword } from '../src/auth/auth.service';

export const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USER || 'petapp',
  password: process.env.DB_PASS || 'petapp123',
  database: process.env.DB_NAME || 'pet_aftercare',
  charset: 'utf8mb4',
  entities: [
    Appointment, TimelineEvent, Store, User, Hospital,
    ColdStorage, FarewellRoomSlot, FurnaceSlot,
    require('../src/entities/ops').FeeItem,
    require('../src/entities/ops').Confirmation,
    require('../src/entities/ops').CremationCertificate,
    Locker,
    require('../src/entities/aftercare').Memento,
    MementoFailureCase,
    require('../src/entities/aftercare').Shipment,
    require('../src/entities/aftercare').Followup,
    require('../src/entities/aftercare').AlbumMedia,
    Message, Payment,
  ],
  synchronize: true,
  timezone: '+08:00',
});

async function main() {
  await ds.initialize();
  await ds.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of ['messages', 'payments', 'album_media', 'followups', 'shipments', 'lockers',
    'memento_failure_cases', 'mementos', 'cremation_certificates', 'cold_storage', 'farewell_room_slots', 'furnace_slots',
    'confirmations', 'fee_items', 'timeline_events', 'appointments', 'hospitals', 'users', 'stores']) {
    await ds.query(`TRUNCATE TABLE \`${t}\``).catch(() => {});
  }
  await ds.query('SET FOREIGN_KEY_CHECKS=1');

  const stores = await ds.getRepository(Store).save([
    { name: '星河路旗舰店', address: '本市星河路 88 号', phone: '021-55001001' },
    { name: '湖畔路服务点', address: '本市湖畔路 12 号', phone: '021-55001002' },
  ]);

  const hp = (p: Partial<User> & { username: string; name: string; role: any; store_id?: number }) =>
    ds.getRepository(User).create({
      password: hashPassword('123456'), phone: '13800000000', ...p,
    });

  const users = await ds.getRepository(User).save([
    hp({ username: 'owner1', name: '王女士', role: 'owner', phone: '13900010001' }),
    hp({ username: 'owner2', name: '李先生', role: 'owner', phone: '13900010002' }),
    hp({ username: 'cs1', name: '客服-周敏', role: 'customer_service', store_id: 1, phone: '13900020001' }),
    hp({ username: 'cs2', name: '客服-陈露', role: 'customer_service', store_id: 2, phone: '13900020002' }),
    hp({ username: 'driver1', name: '接送员-老赵', role: 'driver', store_id: 1, phone: '13900030001' }),
    hp({ username: 'driver2', name: '接送员-小孙', role: 'driver', store_id: 2, phone: '13900030002' }),
    hp({ username: 'rite1', name: '礼仪师-安然', role: 'ceremonialist', store_id: 1, phone: '13900040001' }),
    hp({ username: 'rite2', name: '礼仪师-静怡', role: 'ceremonialist', store_id: 2, phone: '13900040002' }),
    hp({ username: 'fire1', name: '火化师-郑师傅', role: 'cremator', store_id: 1, phone: '13900050001' }),
    hp({ username: 'fire2', name: '火化师-高师傅', role: 'cremator', store_id: 2, phone: '13900050002' }),
    hp({ username: 'art1', name: '纪念品师-阿岚', role: 'artisan', store_id: 1, phone: '13900060001' }),
    hp({ username: 'art2', name: '纪念品师-阿槿', role: 'artisan', store_id: 2, phone: '13900060002' }),
    hp({ username: 'sup1', name: '制作主管-苏晴', role: 'production_supervisor', store_id: 1, phone: '13900060003' }),
    hp({ username: 'fin1', name: '财务-唐会计', role: 'finance', store_id: 1, phone: '13900070001' }),
    hp({ username: 'manager1', name: '运营总监-林总', role: 'manager', phone: '13900080001' }),
  ]);

  await ds.getRepository(Hospital).save([
    { name: '爱诺宠物医院（星河路店）', contact: '刘医生', phone: '021-66001111', store_id: 1 },
    { name: '湖畔动物诊所', contact: '赵医生', phone: '021-66002222', store_id: 2 },
  ]);

  // 每店：3 个冷藏位、2 台火化炉、2 间告别室、12 个寄存柜位
  const cold: Partial<ColdStorage>[] = [];
  const rooms: Partial<FarewellRoomSlot>[] = [];
  const lockers: Partial<Locker>[] = [];
  for (const s of stores) {
    for (let i = 1; i <= 3; i++) {
      cold.push({ store_id: s.id, cell_name: `C${s.id}-0${i}`, status: 'free' });
    }
    for (const t of ['宁静厅', '追思厅']) {
      rooms.push({ store_id: s.id, room_name: `${t}(${s.id}号店)`,
        start_at: new Date(), end_at: new Date(), status: 'free', appointment_id: null });
    }
    for (let i = 1; i <= 6; i++) {
      for (const tier of ['standard', 'premium'] as const) {
        lockers.push({
          store_id: s.id,
          code: `${s.id === 1 ? 'A' : 'B'}-${tier === 'standard' ? '01' : '02'}-${String(i).padStart(2, '0')}`,
          tier, status: 'free', annual_fee: tier === 'standard' ? '600.00' : '980.00',
        });
      }
    }
  }
  await ds.getRepository(ColdStorage).save(cold as any);
  await ds.getRepository(FarewellRoomSlot).save(rooms as any);
  await ds.getRepository(Locker).save(lockers as any);

  // 火化炉作为目录存在（排期记录在 furnace_slots）
  console.log('种子完成：');
  console.log(`门店 ${stores.length} 家，账号 ${users.length} 个（密码均为 123456）`);
  console.log('主要账号：owner1 / cs1 / driver1 / rite1 / fire1 / art1 / sup1 / fin1 / manager1');
  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
