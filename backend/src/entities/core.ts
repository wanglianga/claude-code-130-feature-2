import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 门店 / 服务点 */
@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 100 }) name: string;
  @Column({ length: 200 }) address: string;
  @Column({ length: 30 }) phone: string;
  @CreateDateColumn() created_at: Date;
}

export type UserRole =
  | 'owner'           // 宠物主人
  | 'customer_service'// 客服
  | 'driver'          // 接送员
  | 'ceremonialist'   // 礼仪师
  | 'cremator'        // 火化师
  | 'artisan'         // 纪念品制作
  | 'artisan_supervisor' // 纪念品制作主管（复核失败处理）
  | 'finance'         // 财务
  | 'manager';        // 管理者

/** 平台账号（主人与员工统一表） */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60, unique: true }) username: string;
  @Column({ length: 120 }) password: string;
  @Column({ length: 50 }) name: string;
  @Column({ length: 30 }) phone: string;
  @Column({ type: 'varchar', length: 30 }) role: UserRole;
  @Column({ nullable: true }) store_id: number;
  @CreateDateColumn() created_at: Date;
}

/** 宠物医院转介来源 */
@Entity('hospitals')
export class Hospital {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  @Column({ length: 50 }) contact: string;
  @Column({ length: 30 }) phone: string;
  @Column() store_id: number;
}
