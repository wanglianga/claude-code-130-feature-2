import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 纪念品制作单（爪印、毛发纪念等）—— 状态影响客服回访节奏 */
@Entity('mementos')
export class Memento {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** pawprint 爪印 / hair 毛发纪念 / photo_album 相册周边 / other */
  @Column({ length: 20 }) kind: string;
  @Column({ length: 120 }) name: string;
  /** pending 待制作 / making 制作中 / failed 制作失败 / done 完成 / remake 重做中 */
  @Column({ length: 12, default: 'pending' })
  status: 'pending' | 'making' | 'failed' | 'remake' | 'done';
  @Column({ type: 'datetime', nullable: true }) due_at: Date;       // 承诺交付时间
  @Column({ type: 'datetime', nullable: true }) finished_at: Date;
  @Column({ nullable: true }) artisan_id: number;
  @Column({ type: 'text', nullable: true }) fail_reason: string;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  /** 剩余可用材料：爪印泥（份）/ 毛发纪念瓶内留存毛发（份）等，失败会消耗，重做会再占用 */
  @Column({ type: 'int', default: 1 }) material_remaining: number;
  /** 材料名称（如 爪印泥 / 宠物毛发），随制作单一起排期 */
  @Column({ length: 60, default: '剩余材料' }) material_name: string;
  /** 重做次数：每次重做占用一份剩余材料 */
  @Column({ type: 'int', default: 0 }) remake_count: number;
  @CreateDateColumn() created_at: Date;
}

/**
 * 纪念品制作失败处理单：平台关联制作人、剩余可用材料和主人选择。
 * 客服可提供 remake 重做 / refund 退款 / alternative 替代纪念品；
 * 主人确认后费用调整与制作排期同步更新（费用变化同步财务、制作人员同步查看），制作主管复核。
 */
@Entity('memento_failure_cases')
export class MementoFailureCase {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column() memento_id: number;
  /** 失败时关联的制作人与剩余材料快照 */
  @Column({ nullable: true }) artisan_id: number;
  @Column({ length: 60, default: '剩余材料' }) material_name: string;
  /** 失败时剩余 / 处理后剩余（主人确认后落定） */
  @Column({ type: 'int', default: 0 }) material_on_fail: number;
  @Column({ type: 'int', default: 0 }) material_after: number;
  @Column({ type: 'text', nullable: true }) fail_reason: string;

  /** remake 重做（占用剩余材料）/ refund 退款 / alternative 替代纪念品 */
  @Column({ type: 'varchar', length: 12, default: 'remake' })
  option: 'remake' | 'refund' | 'alternative';

  /** review_pending 客服已提案待制作主管复核 / review_rejected 主管驳回待客服修改 /
   *  owner_pending 复核通过待主人确认 / owner_rejected 主人不接受待客服重新提案 /
   *  applied 主人已确认，费用与排期已同步执行 / finance_done 财务已确认费用调整入账 /
   *  closed 家属评价后闭环 */
  @Column({ type: 'varchar', length: 16, default: 'review_pending' })
  status: 'review_pending' | 'review_rejected' | 'owner_pending' | 'owner_rejected'
    | 'applied' | 'finance_done' | 'closed';

  /** 客服必须向主人说明的不可逆风险（爪印泥碎裂/毛发余量不足等） */
  @Column({ type: 'text' }) risk_notice: string;
  @Column({ type: 'text', nullable: true }) option_note: string;
  /** 替代纪念品名称（option=alternative 时） */
  @Column({ length: 120, nullable: true }) alternative_name: string;

  /** 费用调整：负数为退款/冲减，正数为替代纪念品差价补收；0 表示不调整 */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 }) fee_delta: string;
  /** 关联的费用变更项（主人确认后生成，待家属确认入账） */
  @Column({ nullable: true }) fee_item_id: number;
  /** 重做时承诺交付时间（默认 3 日） */
  @Column({ type: 'datetime', nullable: true }) remake_due_at: Date;

  // —— 人员/时间留痕 ——
  @Column({ nullable: true }) cs_id: number;             // 提案客服
  @Column({ type: 'datetime', nullable: true }) proposed_at: Date;
  @Column({ nullable: true }) owner_id: number;          // 主人选择
  @Column({ type: 'datetime', nullable: true }) owner_decided_at: Date;
  @Column({ type: 'varchar', length: 20, nullable: true }) owner_decision: 'accepted' | 'rejected';
  @Column({ type: 'text', nullable: true }) owner_note: string;
  @Column({ nullable: true }) supervisor_id: number;     // 制作主管复核
  @Column({ type: 'datetime', nullable: true }) reviewed_at: Date;
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  review_status: 'pending' | 'approved' | 'rejected';
  @Column({ type: 'text', nullable: true }) review_note: string;
  @Column({ type: 'datetime', nullable: true }) applied_at: Date;

  /** 家属评价（处理结果影响最终评价）：1-5 分 */
  @Column({ type: 'int', nullable: true }) rating: number;
  @Column({ type: 'text', nullable: true }) rating_note: string;
  @Column({ type: 'datetime', nullable: true }) rated_at: Date;

  /** 财务处理留痕（费用变化同步财务，财务确认退款/冲减/补收入账后回写） */
  @Column({ nullable: true }) finance_id: number;
  @Column({ type: 'datetime', nullable: true }) finance_handled_at: Date;
  @Column({ type: 'text', nullable: true }) finance_note: string;

  @CreateDateColumn() created_at: Date;
}

/** 骨灰盒寄送单：破损可登记异常并补发 */
@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ length: 40 }) tracking_no: string;
  @Column({ length: 40 }) carrier: string;
  @Column({ type: 'datetime' }) ship_at: Date;
  @Column({ type: 'datetime', nullable: true }) delivered_at: Date;
  /** in_transit 在途 / delivered 已签收 / damaged 破损 / resent 已补发 / claimed 家属认领 */
  @Column({ length: 12, default: 'in_transit' })
  status: 'in_transit' | 'delivered' | 'damaged' | 'resent' | 'claimed';
  @Column({ type: 'text', nullable: true }) damage_note: string;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @Column({ length: 40, nullable: true }) resend_tracking_no: string;
  @CreateDateColumn() created_at: Date;
}

/** 寄存柜位 */
@Entity('lockers')
export class Locker {
  @PrimaryGeneratedColumn() id: number;
  @Column() store_id: number;
  @Column({ length: 20 }) code: string;           // 如 A-01-03
  @Column({ length: 20, default: 'standard' }) tier: 'standard' | 'premium';
  /** free 空闲 / occupied 占用中 / expiring 即将到期（30天内）/ expired 已到期 */
  @Column({ length: 12, default: 'free' })
  status: 'free' | 'occupied' | 'expiring' | 'expired';
  @Column({ nullable: true }) appointment_id: number;
  @Column({ type: 'datetime', nullable: true }) occupied_since: Date;
  @Column({ type: 'datetime', nullable: true }) expire_at: Date;   // 年费到期
  @Column({ type: 'decimal', precision: 8, scale: 2, default: 600 }) annual_fee: string;
}

/** 情感回访记录（含情绪安抚）—— 回访节奏由柜位/纪念品状态驱动 */
@Entity('followups')
export class Followup {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ type: 'datetime' }) planned_at: Date;   // 计划回访时间
  @Column({ type: 'datetime', nullable: true }) done_at: Date;
  /** scheduled 待回访 / done 已完成 / skipped 跳过 */
  @Column({ length: 12, default: 'scheduled' }) status: 'scheduled' | 'done' | 'skipped';
  /** routine 常规 / memento_failed 纪念品失败关怀 / locker_expiring 柜位到期提醒 /
   *  locker_expired 到期未续费 / post_service 服务后情绪安抚 */
  @Column({ length: 20 }) trigger: string;
  @Column({ type: 'text', nullable: true }) emotion_note: string; // 家属情绪记录
  @Column({ type: 'text', nullable: true }) content: string;
  @Column({ nullable: true }) cs_id: number;
  @CreateDateColumn() created_at: Date;
}

/** 纪念相册（照片/视频归档，与时间线材料互补） */
@Entity('album_media')
export class AlbumMedia {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column({ length: 120 }) title: string;
  /** photo / video */
  @Column({ length: 10 }) kind: string;
  @Column({ length: 255 }) url: string;
  @Column({ length: 200, nullable: true }) caption: string;
  @Column({ nullable: true }) uploader_id: number;
  @CreateDateColumn() created_at: Date;
}
