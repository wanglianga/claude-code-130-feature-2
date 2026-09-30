import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/** 纪念品制作单（爪印、毛发纪念等）—— 状态影响客服回访节奏 */
@Entity('mementos')
export class Memento {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  /** pawprint 爪印泥 / hair 毛发纪念瓶 / photo_album 相册周边 / other */
  @Column({ length: 20 }) kind: string;
  @Column({ length: 120 }) name: string;
  /** pending 待制作 / making 制作中 / failed 制作失败 / remake 重做中 /
   *  done 完成 / refunded 已退款不再交付 / replaced 已以替代纪念品交付 */
  @Column({ length: 12, default: 'pending' })
  status: 'pending' | 'making' | 'failed' | 'remake' | 'done' | 'refunded' | 'replaced';
  @Column({ type: 'datetime', nullable: true }) due_at: Date;       // 承诺交付时间
  @Column({ type: 'datetime', nullable: true }) finished_at: Date;
  @Column({ nullable: true }) artisan_id: number;                  // 平台关联制作人
  @Column({ type: 'text', nullable: true }) fail_reason: string;
  /** 失败时登记：剩余可用材料描述（如「余泥 2 份 / 毛发余量 0.3g」） */
  @Column({ type: 'text', nullable: true }) remaining_materials: string;
  /** 失败时登记：主人对该纪念品的原始选择备注（如「要深棕泥+名字刻字」） */
  @Column({ type: 'text', nullable: true }) owner_choice: string;
  /** 本纪念品累计重做占用的材料份数 */
  @Column({ type: 'int', default: 0 }) remake_material_used: number;
  /** 失败处理工单 id（立案后回填） */
  @Column({ nullable: true }) failure_case_id: number;
  @Column({ type: 'json', nullable: true }) media_urls: string[];
  @CreateDateColumn() created_at: Date;
}

/**
 * 纪念品制作失败处理工单：一次失败一条。
 * 平台关联制作人、剩余可用材料、主人选择；
 * 客服提出 重做 / 退款 / 替代纪念品 方案 → 主人确认（费用调整+制作排期同步）
 * → 财务同步费用 → 制作人员查看执行 → 制作主管复核 → 家属评价。
 */
@Entity('memento_failure_cases')
export class MementoFailureCase {
  @PrimaryGeneratedColumn() id: number;
  @Index()
  @Column() appointment_id: number;
  @Column() memento_id: number;
  /** 关联制作人（失败时该制作单的 artisan_id） */
  @Column({ nullable: true }) artisan_id: number;
  /** 客服经办人 */
  @Column({ nullable: true }) cs_id: number;

  // —— 失败事实快照 ——
  @Column({ length: 20 }) kind: string;
  @Column({ length: 120 }) memento_name: string;
  @Column({ type: 'text', nullable: true }) fail_reason: string;
  @Column({ type: 'text', nullable: true }) remaining_materials: string;
  @Column({ type: 'text', nullable: true }) owner_choice: string;
  /** 剩余可重做次数（材料是否还够） */
  @Column({ type: 'int', default: 0 }) remaining_attempts: number;

  /**
   * open 待客服拟方案 / proposed 已拟方案待主人确认 / owner_rejected 主人拒绝待重拟 /
   * remake_confirmed 已确认重做 / refund_confirmed 已确认退款 /
   * alternative_confirmed 已确认替代 / reviewing 制作完成待主管复核 /
   * reviewed 主管已复核 / closed 已结案（含家属评价）
   */
  @Column({ length: 24, default: 'open' })
  status: 'open' | 'proposed' | 'owner_rejected'
    | 'remake_confirmed' | 'refund_confirmed' | 'alternative_confirmed'
    | 'reviewing' | 'reviewed' | 'closed';

  // —— 客服拟定的处理方案（三选一）——
  /** remake 重做 / refund 退款 / alternative 替代纪念品 */
  @Column({ length: 12, nullable: true }) resolution: 'remake' | 'refund' | 'alternative';
  /** 费用调整金额（负数为退/减，正数为补收）；主人确认后写入费用项并同步财务 */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) fee_adjustment: string;
  @Column({ length: 255, nullable: true }) fee_title: string;
  /** 重做/替代承诺交付时间（确认后同步制作排期 memento.due_at） */
  @Column({ type: 'datetime', nullable: true }) promised_at: Date;
  /** 不可逆风险说明（如剩余毛发/爪印泥为唯一纪念材料，再次失败将无法重做） */
  @Column({ type: 'text', nullable: true }) irreversible_risk: string;
  /** 重做将占用的剩余材料描述/份数 */
  @Column({ type: 'text', nullable: true }) material_consume: string;
  /** 替代纪念品名称（resolution=alternative 时） */
  @Column({ length: 120, nullable: true }) alternative_name: string;
  @Column({ type: 'text', nullable: true }) proposal_note: string;

  // —— 确认与执行 ——
  @Column({ type: 'datetime', nullable: true }) proposed_at: Date;
  @Column({ type: 'datetime', nullable: true }) owner_confirmed_at: Date;
  /** 确认后生成的费用变更项 id（财务可据此核对） */
  @Column({ nullable: true }) fee_item_id: number;
  @Column({ type: 'datetime', nullable: true }) executed_at: Date;
  /** 替代纪念品交付时生成的新制作单 id */
  @Column({ nullable: true }) replacement_memento_id: number;

  // —— 主管复核 ——
  @Column({ nullable: true }) supervisor_id: number;
  @Column({ type: 'datetime', nullable: true }) reviewed_at: Date;
  /** approved 通过 / rejected 退回重做 */
  @Column({ length: 12, nullable: true }) review_result: 'approved' | 'rejected';
  @Column({ type: 'text', nullable: true }) review_note: string;

  // —— 家属评价 ——
  /** 1~5 星，处理结果影响最终费用与家属评价 */
  @Column({ type: 'int', nullable: true }) rating: number;
  @Column({ type: 'text', nullable: true }) rating_note: string;
  @Column({ type: 'datetime', nullable: true }) rated_at: Date;

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
