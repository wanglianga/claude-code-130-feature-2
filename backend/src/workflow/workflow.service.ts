import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Appointment, AppointmentStatus, TimelineEvent } from '../entities/appointment';
import { Store, User, Hospital } from '../entities/core';
import {
  ColdStorage, Confirmation, FarewellRoomSlot, FeeItem, FurnaceSlot, CremationCertificate,
} from '../entities/ops';
import { AlbumMedia, Followup, Locker, Memento, MementoFailureCase, Shipment } from '../entities/aftercare';
import { Message, Payment } from '../entities/billing';
import { suggestQuote, weightAdjustment } from './pricing';

type U = { sub: number; name: string; role: string; store_id?: number };

@Injectable()
export class WorkflowService {
  constructor(
    private ds: DataSource,
    @InjectRepository(Appointment) private appts: Repository<Appointment>,
    @InjectRepository(TimelineEvent) private timeline: Repository<TimelineEvent>,
    @InjectRepository(FeeItem) private fees: Repository<FeeItem>,
    @InjectRepository(Confirmation) private confirms: Repository<Confirmation>,
    @InjectRepository(FurnaceSlot) private furnaces: Repository<FurnaceSlot>,
    @InjectRepository(FarewellRoomSlot) private rooms: Repository<FarewellRoomSlot>,
    @InjectRepository(ColdStorage) private cold: Repository<ColdStorage>,
    @InjectRepository(CremationCertificate) private certs: Repository<CremationCertificate>,
    @InjectRepository(Memento) private mementos: Repository<Memento>,
    @InjectRepository(MementoFailureCase) private failureCases: Repository<MementoFailureCase>,
    @InjectRepository(Shipment) private shipments: Repository<Shipment>,
    @InjectRepository(Locker) private lockers: Repository<Locker>,
    @InjectRepository(Followup) private followups: Repository<Followup>,
    @InjectRepository(AlbumMedia) private albums: Repository<AlbumMedia>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
    @InjectRepository(Message) private messages: Repository<Message>,
    @InjectRepository(Store) private stores: Repository<Store>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Hospital) private hospitals: Repository<Hospital>,
  ) {}

  // ============ 基础工具 ============

  async event(
    appointmentId: number, nodeKey: string, title: string,
    opts: { flag?: 'normal' | 'exception' | 'resolved'; actor?: U; note?: string;
            media?: string[]; promisedAt?: Date; occurredAt?: Date } = {},
  ) {
    return this.timeline.save(this.timeline.create({
      appointment_id: appointmentId,
      node_key: nodeKey,
      title,
      flag: opts.flag || 'normal',
      actor_id: opts.actor?.sub,
      actor_role: opts.actor?.role,
      note: opts.note || null,
      media_urls: opts.media || null,
      promised_at: opts.promisedAt || null,
      occurred_at: opts.occurredAt || new Date(),
    }));
  }

  async getAccessible(id: number, user: U): Promise<Appointment> {
    const a = await this.appts.findOne({ where: { id } });
    if (!a) throw new NotFoundException('预约单不存在');
    if (user.role === 'owner' && a.owner_id !== user.sub) throw new ForbiddenException('无权查看他人预约');
    if (user.role !== 'owner' && user.role !== 'manager' && a.store_id !== user.store_id) {
      throw new ForbiddenException('跨门店数据不可访问');
    }
    return a;
  }

  assertStatus(a: Appointment, ...allowed: AppointmentStatus[]) {
    if (!allowed.includes(a.status)) {
      throw new BadRequestException(`当前状态「${a.status}」不允许该操作，需处于：${allowed.join(' / ')}`);
    }
  }

  genCode() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `PA${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${Math.floor(Math.random() * 900 + 100)}`;
  }

  // ============ 主人：提交预约 ============

  async submit(dto: any, user: U) {
    const store = await this.stores.findOne({ where: { id: Number(dto.store_id) } });
    if (!store) throw new BadRequestException('请选择有效门店');
    const a = this.appts.create({
      code: this.genCode(),
      store_id: store.id,
      owner_id: user.sub,
      hospital_id: dto.hospital_id ? Number(dto.hospital_id) : null,
      pet_name: dto.pet_name,
      pet_type: dto.pet_type,
      pet_breed: dto.pet_breed,
      weight_kg: dto.weight_kg,
      death_time: new Date(dto.death_time),
      need_pickup: !!dto.need_pickup,
      pickup_address: dto.pickup_address || null,
      want_ceremony: !!dto.want_ceremony,
      private_cremation: !!dto.private_cremation,
      want_urn: !!dto.want_urn,
      pawprint_hair: !!dto.pawprint_hair,
      photo_video: !!dto.photo_video,
      storage_months: Number(dto.storage_months || 0),
    });
    const saved = await this.appts.save(a);
    const sug = suggestQuote(saved as any);
    await this.event(saved.id, 'submitted', '主人提交善终服务预约', {
      actor: user, note: `系统建议报价 ${sug.total} 元，待客服确认方案`,
    });
    return saved;
  }

  async list(user: U, query: any) {
    const qb = this.appts.createQueryBuilder('a').orderBy('a.id', 'DESC');
    if (user.role === 'owner') qb.where('a.owner_id = :uid', { uid: user.sub });
    else if (user.role !== 'manager') qb.where('a.store_id = :sid', { sid: user.store_id });
    if (query.status) qb.andWhere('a.status = :st', { st: query.status });
    if (query.store_id && user.role === 'manager') qb.andWhere('a.store_id = :sid2', { sid2: query.store_id });
    return qb.limit(200).getMany();
  }

  async detail(id: number, user: U) {
    const a = await this.getAccessible(id, user);
    const [
      timeline, fees, confirmations, furnaces, rooms, coldRows, cert,
      mementos, shipments, locker, followups, album, payments, messages, failureCases,
    ] = await Promise.all([
      this.timeline.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.fees.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.confirms.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.furnaces.find({ where: { appointment_id: id } }),
      this.rooms.find({ where: { appointment_id: id } }),
      this.cold.find({ where: { appointment_id: id } }),
      this.certs.findOne({ where: { appointment_id: id } }),
      this.mementos.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.shipments.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.lockers.findOne({ where: { appointment_id: id } }),
      this.followups.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.albums.find({ where: { appointment_id: id }, order: { id: 'DESC' } }),
      this.payments.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.messages.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.failureCases.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
    ]);
    const owner = await this.users.findOne({ where: { id: a.owner_id } });
    // 纪念品失败处理单关联人员（制作人 / 客服 / 主管 / 财务）姓名，供各端展示
    const caseUserIds = new Set<number>();
    failureCases.forEach(c => {
      [c.artisan_id, c.cs_id, c.supervisor_id, c.finance_id].forEach(id => { if (id) caseUserIds.add(id); });
    });
    const caseUserRows = caseUserIds.size ? await this.users.find({ where: { id: In([...caseUserIds]) } }) : [];
    const caseUsers: Record<number, { name: string; role: string; phone: string }> = {};
    caseUserRows.forEach(u => { caseUsers[u.id] = { name: u.name, role: u.role, phone: u.phone }; });
    const quoteTotal = fees.filter(f => f.entry_type === 'base')
      .reduce((s, f) => s + Number(f.amount), 0);
    const confirmedChange = fees.filter(f => f.entry_type === 'change' && f.confirm_status === 'confirmed')
      .reduce((s, f) => s + Number(f.amount), 0);
    const pendingChange = fees.filter(f => f.entry_type === 'change' && f.confirm_status === 'pending')
      .reduce((s, f) => s + Number(f.amount), 0);
    const paid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);
    const refunded = payments.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
    // 未闭环异常数：按「异常事件 − 已闭环事件」统计，单个工单不计负数
    const openExceptions = Math.max(0,
      timeline.filter(t => t.flag === 'exception').length
      - timeline.filter(t => t.flag === 'resolved').length);
    return {
      appointment: a,
      owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone } : null,
      timeline, fees, confirmations, furnaces, rooms, cold_storage: coldRows,
      certificate: cert, mementos, shipments, locker, followups, album, payments, messages,
      memento_cases: failureCases, memento_case_users: caseUsers,
      fee_summary: {
        quote_total: quoteTotal,
        confirmed_change: confirmedChange,
        pending_change: pendingChange,
        payable: quoteTotal + confirmedChange + pendingChange,
        paid, refunded,
        balance: quoteTotal + confirmedChange + pendingChange - paid + refunded,
      },
      open_exceptions: openExceptions,
    };
  }

  // ============ 客服：确认方案、费用变更、调度、改期 ============

  async confirmPlan(id: number, dto: any, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'submitted', 'cs_confirmed', 'scheduled');
    const sug = suggestQuote({ ...a, ...dto } as any);
    const overrideTotal = dto.total != null ? Number(dto.total) : null;
    return this.ds.transaction(async m => {
      // 重新出方案：先清除旧 base
      await m.getRepository(FeeItem).delete({ appointment_id: id, entry_type: 'base' as any });
      if (overrideTotal != null) {
        await m.getRepository(FeeItem).insert(m.getRepository(FeeItem).create({
          appointment_id: id, kind: 'base_quote', title: '服务方案报价（客服核定）',
          amount: String(overrideTotal.toFixed(2)), entry_type: 'base', confirm_status: 'confirmed',
          operator_id: user.sub,
        }));
      } else {
        for (const it of sug.items) {
          await m.getRepository(FeeItem).insert(m.getRepository(FeeItem).create({
            appointment_id: id, kind: it.kind, title: it.title,
            amount: String(it.amount.toFixed(2)), entry_type: 'base',
            confirm_status: 'confirmed', operator_id: user.sub,
          }));
        }
      }
      const total = overrideTotal != null ? overrideTotal : sug.total;
      await m.getRepository(Appointment).update(id, { quote_amount: String(total.toFixed(2)),
        final_amount: String(total.toFixed(2)), status: 'cs_confirmed' });
      await m.getRepository(Confirmation).delete({ appointment_id: id, subject: 'plan' as any,
        status: 'pending' as any });
      await m.getRepository(Confirmation).insert(m.getRepository(Confirmation).create({
        appointment_id: id, subject: 'plan',
        content: `服务方案已核定，报价 ${total} 元，请家属确认。`,
        status: 'pending', requested_by: user.sub,
      }));
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'cs_confirmed', flag: 'normal',
        title: `客服确认服务方案，报价 ${total} 元`, actor_id: user.sub, actor_role: user.role,
        occurred_at: new Date(),
      }));
    });
  }

  /** 通用费用变更（体重不符补差、超距、退款冲减等）—— 必须家属确认 */
  async addFeeChange(id: number, dto: { kind: string; title: string; amount: number; reason: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const fee = await this.fees.save(this.fees.create({
      appointment_id: id, kind: dto.kind, title: dto.title,
      amount: String(Number(dto.amount).toFixed(2)), reason: dto.reason,
      operator_id: user.sub, entry_type: 'change', confirm_status: 'pending',
    }));
    await this.confirms.save(this.confirms.create({
      appointment_id: id, subject: 'fee_change',
      content: `费用变更：${dto.title} ${Number(dto.amount) >= 0 ? '+' : ''}${dto.amount} 元。原因：${dto.reason} [FEE]${fee.id}[/FEE]`,
      status: 'pending', requested_by: user.sub,
    }));
    await this.event(id, 'fee_change', `费用变更待确认：${dto.title}`, {
      actor: user, flag: 'exception', note: `${dto.reason}；金额 ${dto.amount} 元`,
    });
    return fee;
  }

  /** 调度：人、车、冷藏、火化炉、告别室一次排好，并依选项生成纪念品制作单 */
  async dispatch(id: number, dto: any, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'cs_confirmed', 'scheduled');
    const pickupAt = new Date(dto.pickup_at);
    const ceremonyAt = new Date(dto.ceremony_at);
    const furnaceAt = new Date(dto.furnace_at);
    return this.ds.transaction(async m => {
      // 重新调度：释放该单此前锁定但未执行的档期
      await m.getRepository(FurnaceSlot).delete({ appointment_id: id, status: 'locked' as any });
      await m.getRepository(FarewellRoomSlot).delete({ appointment_id: id, status: 'locked' as any });
      await m.getRepository(Memento).delete({ appointment_id: id, status: 'pending' as any });
      await m.getRepository(Appointment).update(id, {
        driver_id: Number(dto.driver_id), ceremonialist_id: Number(dto.ceremonialist_id),
        cremator_id: Number(dto.cremator_id),
        pickup_promised_at: pickupAt, ceremony_scheduled_at: ceremonyAt, furnace_scheduled_at: furnaceAt,
        status: 'scheduled',
      });
      // 资源排期（锁档期，重复锁直接报错）
      const lock = async (repo: any, label: string, data: any) => {
        const overlapping = await repo.createQueryBuilder('r')
          .where('r.store_id = :sid', { sid: a.store_id })
          .andWhere('r.status = :st', { st: 'locked' })
          .andWhere('r.start_at < :end AND r.end_at > :start',
            { start: data.start_at, end: data.end_at })
          .andWhere(`${label} = :name`, { name: data[label] })
          .getOne();
        if (overlapping) throw new BadRequestException(`${data[label]} 该时段已被占用`);
        await repo.insert(repo.create({ ...data, appointment_id: id, status: 'locked' }));
      };
      if (a.need_pickup) {
        const cold = await m.getRepository(ColdStorage).findOne({
          where: { store_id: a.store_id, status: 'free' } });
        if (!cold) throw new BadRequestException('门店无空闲冷藏暂存位');
        await m.getRepository(ColdStorage).update(cold.id, { appointment_id: id, status: 'occupied' });
      }
      await lock(m.getRepository(FurnaceSlot), 'furnace_name', {
        store_id: a.store_id, furnace_name: dto.furnace_name,
        start_at: furnaceAt, end_at: new Date(+furnaceAt + 90 * 60000),
      });
      if (a.want_ceremony) {
        await lock(m.getRepository(FarewellRoomSlot), 'room_name', {
          store_id: a.store_id, room_name: dto.room_name,
          start_at: ceremonyAt, end_at: new Date(+ceremonyAt + 60 * 60000),
        });
      }
      // 纪念品制作单（关联剩余可用材料：爪印泥 / 宠物毛发）
      const MATERIAL: Record<string, { name: string; qty: number }> = {
        pawprint: { name: '爪印泥', qty: 2 },
        hair: { name: '留存宠物毛发', qty: 1 },
        photo_album: { name: '照片视频素材', qty: 1 },
      };
      const mkMemento = (kind: string, name: string) => {
        const mat = MATERIAL[kind] || { name: '剩余材料', qty: 1 };
        return m.getRepository(Memento).insert(m.getRepository(Memento).create({
          appointment_id: id, kind, name, status: 'pending',
          due_at: furnaceAt, artisan_id: dto.artisan_id || null,
          material_name: mat.name, material_remaining: mat.qty,
        }));
      };
      if (a.pawprint_hair) await mkMemento('pawprint', '爪印纪念品');
      if (a.pawprint_hair) await mkMemento('hair', '毛发纪念坠');
      if (a.photo_video) await mkMemento('photo_album', '照片视频纪念相册');

      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'scheduled', flag: 'normal', actor_id: user.sub, actor_role: user.role,
        title: '客服完成调度：接送员/冷藏/火化炉/告别室/纪念品已排期',
        promised_at: pickupAt, occurred_at: new Date(),
        note: `承诺接运 ${pickupAt.toLocaleString('zh-CN')}；告别 ${ceremonyAt.toLocaleString('zh-CN')}；火化 ${furnaceAt.toLocaleString('zh-CN')}`,
      }));
    });
  }

  /** 家属/客服发起改期请求 */
  async requestReschedule(id: number, dto: { new_time: string; reason: string }, user: U) {
    const a = await this.getAccessible(id, user);
    if (['cremating', 'fulfilled', 'completed', 'cancelled'].includes(a.status)) {
      throw new BadRequestException('当前环节已不可更改仪式时间');
    }
    const iso = new Date(dto.new_time).toISOString();
    await this.confirms.save(this.confirms.create({
      appointment_id: id, subject: 'ceremony_time',
      content: `申请将告别仪式时间改为 ${new Date(dto.new_time).toLocaleString('zh-CN')}。原因：${dto.reason} [TIME]${iso}[/TIME]`,
      status: 'pending', requested_by: user.sub, reply_note: dto.reason,
    }));
    await this.event(id, 'ceremony_reschedule', '家属申请更改仪式时间，待客服处理', {
      actor: user, flag: 'exception', note: dto.reason, promisedAt: new Date(dto.new_time),
    });
  }

  async approveReschedule(id: number, confirmationId: number, dto: { approve: boolean; note?: string; new_time?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const c = await this.confirms.findOne({ where: { id: confirmationId, appointment_id: id } });
    if (!c || c.subject !== 'ceremony_time') throw new NotFoundException('改期申请不存在');
    if (!dto.approve) {
      await this.confirms.update(c.id, { status: 'rejected', confirmed_at: new Date(), reply_note: dto.note });
      await this.event(id, 'ceremony_reschedule', '客服驳回改期申请', { actor: user, flag: 'resolved', note: dto.note });
      return;
    }
    const marker = c.content.match(/\[TIME\](.*?)\[\/TIME\]/);
    const target = new Date(dto.new_time || (marker ? marker[1] : Date.now()));
    await this.ds.transaction(async m => {
      await m.getRepository(Confirmation).update(c.id,
        { status: 'confirmed', confirmed_at: new Date(), reply_note: dto.note || '同意改期' });
      await m.getRepository(Appointment).update(id, { ceremony_scheduled_at: target });
      // 重新排告别室
      await m.getRepository(FarewellRoomSlot).update({ appointment_id: id, status: 'locked' as any },
        { start_at: target, end_at: new Date(+target + 60 * 60000) });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'ceremony_reschedule', flag: 'resolved',
        title: `客服同意改期，新仪式时间 ${target.toLocaleString('zh-CN')}`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
      }));
    });
  }

  private parseTime(c: Confirmation): Date {
    const m = c.content.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*([^,，。]*)/);
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  async setVideoWitness(id: number, dto: { note: string }, user: U) {
    const a = await this.getAccessible(id, user);
    await this.appts.update(id, { video_witness: true, witness_note: dto.note });
    await this.confirms.save(this.confirms.create({
      appointment_id: id, subject: 'video_witness',
      content: `家属要求视频见证火化过程：${dto.note}`, status: 'confirmed',
      confirmed_at: new Date(), requested_by: user.sub,
    }));
    await this.event(id, 'video_witness', '家属要求视频见证', { actor: user, note: dto.note });
  }

  // ============ 确认应答（家属） ============

  async respondConfirmation(id: number, cid: number, dto: { approve: boolean; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const c = await this.confirms.findOne({ where: { id: cid, appointment_id: id } });
    if (!c) throw new NotFoundException('确认事项不存在');
    if (c.status !== 'pending') throw new BadRequestException('该事项已处理');
    if (c.subject === 'ceremony_time') {
      throw new BadRequestException('改期申请须由客服审批排期，请等待客服处理');
    }
    if (c.subject === 'memento_case') {
      if (user.role !== 'owner') throw new ForbiddenException('失败处理方案须由主人本人确认');
      const marker = c.content.match(/\[CASE\](\d+)\[\/CASE\]/);
      if (!marker) throw new BadRequestException('确认事项缺少处理单关联');
      const mc = await this.failureCases.findOne({ where: { id: Number(marker[1]) } });
      if (!mc) throw new NotFoundException('失败处理单不存在');
      if (mc.status !== 'owner_pending') throw new BadRequestException('该处理方案当前不可确认');
      await this.confirms.update(cid, {
        status: dto.approve ? 'confirmed' : 'rejected',
        confirmed_at: new Date(), reply_note: dto.note || null,
      });
      await this.decideMementoCase(mc, dto.approve, dto.note, user);
      return;
    }
    await this.confirms.update(cid, {
      status: dto.approve ? 'confirmed' : 'rejected',
      confirmed_at: new Date(), reply_note: dto.note || null,
    });
    if (c.subject === 'fee_change') {
      // 通过内容标记精确定位费用项，避免多条待确认变更错配
      const marker = c.content.match(/\[FEE\](\d+)\[\/FEE\]/);
      const fee = marker
        ? await this.fees.findOne({ where: { id: Number(marker[1]), appointment_id: id } })
        : await this.fees.findOne({
            where: { appointment_id: id, entry_type: 'change', confirm_status: 'pending' },
            order: { id: 'DESC' },
          });
      if (fee) {
        await this.fees.update(fee.id, { confirm_status: dto.approve ? 'confirmed' : 'rejected' });
        if (dto.approve) {
          const cur = Number(a.final_amount || a.quote_amount || 0);
          await this.appts.update(id, { final_amount: (cur + Number(fee.amount)).toFixed(2) });
        }
      }
      await this.event(id, 'fee_change',
        dto.approve ? '家属已确认费用变更' : '家属拒绝费用变更，需客服重新协商',
        { actor: user, flag: dto.approve ? 'resolved' : 'exception', note: dto.note });
    } else if (c.subject === 'plan') {
      await this.event(id, 'plan_confirmed', '家属确认服务方案', { actor: user, flag: 'resolved' });
    } else {
      await this.event(id, 'confirmation', `家属${dto.approve ? '确认' : '拒绝'}：${c.subject}`,
        { actor: user, flag: dto.approve ? 'resolved' : 'exception', note: dto.note });
    }
  }

  // ============ 接送员 ============

  async driverDelay(id: number, dto: { minutes: number; reason: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const newPromised = new Date(Math.max(Date.now(),
      +(a.pickup_promised_at || new Date())) + Number(dto.minutes) * 60000);
    await this.appts.update(id, { pickup_promised_at: newPromised });
    await this.event(id, 'pickup_delay', `接送延误 ${dto.minutes} 分钟，承诺时间顺延`, {
      actor: user, flag: 'exception', note: dto.reason, promisedAt: newPromised,
    });
    await this.postMessage(id, user, `【交通延误】${dto.reason}，预计顺延 ${dto.minutes} 分钟，新承诺接运时间 ${newPromised.toLocaleString('zh-CN')}`);
  }

  async pickup(id: number, dto: { actual_weight_kg: number; media: string[]; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'scheduled');
    await this.ds.transaction(async m => {
      await m.getRepository(Appointment).update(id, {
        status: 'picked_up', pickup_actual_at: new Date(), actual_weight_kg: String(dto.actual_weight_kg),
      });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'picked_up', flag: 'normal',
        title: '接送员接走宠物，交接照片已上传', actor_id: user.sub, actor_role: user.role,
        media_urls: dto.media, note: dto.note, occurred_at: new Date(),
      }));
      // 实际接运完成 → 闭环此前的交通延误异常
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'pickup_delay', flag: 'resolved',
        title: '已按顺延承诺时间完成接运，交通延误闭环',
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
      }));
    });
    // 体重与报价不符 → 自动产生补差费用变更，等家属确认
    const adj = weightAdjustment(Number(a.weight_kg), Number(dto.actual_weight_kg));
    if (Math.abs(adj.amount) >= 1) {
      const amount = adj.amount; // 可能为负（退差）
      await this.addFeeChange(id, {
        kind: 'weight_adjust',
        title: `实际体重 ${dto.actual_weight_kg}kg 与登记 ${a.weight_kg}kg 不符，${amount >= 0 ? '补' : '退'}差价`,
        amount, reason: `接送复称体重差 ${adj.diff}kg，按 20 元/kg ${amount >= 0 ? '补收' : '退还'}`,
      }, user);
    }
    await this.postMessage(id, user, `已接到 ${a.pet_name}，现场交接照片已上传，实际体重 ${dto.actual_weight_kg}kg。`);
  }

  async intoCold(id: number, dto: { media: string[]; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'picked_up');
    await this.ds.transaction(async m => {
      const cell = await m.getRepository(ColdStorage).findOne({
        where: { appointment_id: id, status: 'occupied' as any } });
      if (cell) await m.getRepository(ColdStorage).update(cell.id, { in_at: new Date() });
      await m.getRepository(Appointment).update(id, { status: 'in_storage' });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'cold_in', title: '入冷藏暂存，位号已登记',
        actor_id: user.sub, actor_role: user.role, media_urls: dto.media,
        note: cell ? `暂存位：${cell.cell_name}` : (dto.note || ''), occurred_at: new Date(),
      }));
    });
  }

  // ============ 礼仪师：告别 ============

  async startFarewell(id: number, dto: { media: string[]; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'in_storage', 'scheduled');
    await this.appts.update(id, { status: 'farewell', ceremony_started_at: new Date() });
    await this.event(id, 'farewell_start', '告别仪式开始', {
      actor: user, media: dto.media, note: dto.note });
  }

  async endFarewell(id: number, dto: { media: string[]; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'farewell');
    await this.rooms.update({ appointment_id: id, status: 'locked' as any }, { status: 'done' });
    // 释放冷藏
    await this.cold.update({ appointment_id: id, status: 'occupied' as any },
      { status: 'free', out_at: new Date(), appointment_id: null });
    await this.event(id, 'farewell_end', '告别仪式结束，家属道别完成', {
      actor: user, media: dto.media, note: dto.note });
  }

  // ============ 火化师 ============

  async startCremation(id: number, dto: { note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'farewell', 'in_storage');
    const pendingFee = await this.fees.count({
      where: { appointment_id: id, entry_type: 'change', confirm_status: 'pending' } });
    if (pendingFee > 0) throw new BadRequestException('存在家属未确认的费用变更，需先协商确认再火化');
    await this.appts.update(id, { status: 'cremating' });
    await this.event(id, 'cremation_start', '遗体入炉火化开始', { actor: user, note: dto.note });
  }

  async completeCremation(id: number, dto: { media: string[]; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'cremating');
    if (a.video_witness) {
      const ok = await this.confirms.findOne({
        where: { appointment_id: id, subject: 'video_witness', status: 'confirmed' } });
      if (!ok) throw new BadRequestException('家属要求视频见证但未见证安排确认');
    }
    return this.ds.transaction(async m => {
      const certNo = `CR${new Date().getFullYear()}${String(Math.floor(Math.random() * 9e6 + 1e6))}`;
      await m.getRepository(CremationCertificate).insert(m.getRepository(CremationCertificate).create({
        cert_no: certNo, appointment_id: id, cremated_at: new Date(),
        cremator_id: user.sub, private_cremation: a.private_cremation, media_urls: dto.media,
      }));
      await m.getRepository(FurnaceSlot).update({ appointment_id: id, status: 'locked' as any },
        { status: 'done' });
      await m.getRepository(Appointment).update(id, { status: 'fulfilled', cremated_at: new Date() });
      await m.getRepository(TimelineEvent).insert(m.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'cremation_end', flag: 'normal',
        title: `火化完成，火化证明 ${certNo} 已出具`, actor_id: user.sub, actor_role: user.role,
        media_urls: dto.media, note: dto.note, occurred_at: new Date(),
      }));
    });
  }

  // ============ 纪念品 ============

  async mementoAction(mid: number, action: 'start' | 'fail' | 'done', dto: any, user: U) {
    const m = await this.mementos.findOne({ where: { id: mid } });
    if (!m) throw new NotFoundException('纪念品单不存在');
    const a = await this.getAccessible(m.appointment_id, user);
    if (action === 'start') {
      // 制作人开始制作才关联到本人；客服/管理者代操作保留原排定制作人
      await this.mementos.update(mid, {
        status: 'making', artisan_id: user.role === 'artisan' ? user.sub : (m.artisan_id || user.sub) });
      await this.event(a.id, 'memento_start', `纪念品「${m.name}」开始制作`, { actor: user });
    } else if (action === 'fail') {
      if (m.status === 'done') throw new BadRequestException('该纪念品已完成，不能登记失败');
      // 失败消耗一份材料（制作本身占用的那份已不可逆损耗）
      const consumed = Math.max(0, m.material_remaining - 1);
      await this.ds.transaction(async tx => {
        await tx.getRepository(Memento).update(mid, {
          status: 'failed', fail_reason: dto.reason, material_remaining: consumed,
          artisan_id: user.role === 'artisan' ? user.sub : m.artisan_id,
        });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_failed', flag: 'exception',
          title: `纪念品「${m.name}」制作失败，等待客服提出处理方案`,
          actor_id: user.sub, actor_role: user.role, note: dto.reason, occurred_at: new Date(),
        }));
        // 纪念品失败 → 生成专项关怀回访，改变客服回访节奏
        await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
          appointment_id: a.id, trigger: 'memento_failed', planned_at: new Date(),
          content: `纪念品「${m.name}」制作失败（${dto.reason}），立即联系家属说明并安抚情绪，关联制作人 #${user.sub} 与剩余材料 ${consumed} 份`,
        }));
        // 同步制作人员：失败与材料余量可见
        await tx.getRepository(Message).insert(tx.getRepository(Message).create({
          appointment_id: a.id, sender_id: user.sub, sender_role: user.role,
          sender_name: user.name,
          content: `【制作失败登记】${m.name}：${dto.reason}。材料「${m.material_name}」剩余 ${consumed} 份，已转客服提出重做/退款/替代方案。`,
        }));
      });
    } else if (action === 'done') {
      await this.mementos.update(mid, { status: 'done', finished_at: new Date(), media_urls: dto.media || [] });
      await this.event(a.id, 'memento_done', `纪念品「${m.name}」制作完成`, {
        actor: user, media: dto.media });
    }
    return this.mementos.findOne({ where: { id: mid } });
  }

  /** 客服（主管复核前）查询失败处理单 */
  private async getCaseAccessible(caseId: number, user: U): Promise<{ c: MementoFailureCase; a: Appointment; m: Memento }> {
    const c = await this.failureCases.findOne({ where: { id: caseId } });
    if (!c) throw new NotFoundException('失败处理单不存在');
    const a = await this.getAccessible(c.appointment_id, user);
    const m = await this.mementos.findOne({ where: { id: c.memento_id } });
    if (!m) throw new NotFoundException('纪念品单不存在');
    return { c, a, m };
  }

  /**
   * 客服提出失败处理方案：重做 / 退款 / 替代纪念品。
   * 必须填写不可逆风险提示；生成后先进入制作主管复核。
   */
  async proposeMementoCase(mid: number, dto: {
    option: 'remake' | 'refund' | 'alternative';
    risk_notice: string;
    option_note?: string;
    alternative_name?: string;
    fee_delta?: number;
  }, user: U) {
    const m = await this.mementos.findOne({ where: { id: mid } });
    if (!m) throw new NotFoundException('纪念品单不存在');
    const a = await this.getAccessible(m.appointment_id, user);
    if (m.status !== 'failed') throw new BadRequestException('仅制作失败的纪念品可提出处理方案');
    if (!['remake', 'refund', 'alternative'].includes(dto.option)) {
      throw new BadRequestException('处理方式须为 remake 重做 / refund 退款 / alternative 替代纪念品');
    }
    if (!dto.risk_notice || !String(dto.risk_notice).trim()) {
      throw new BadRequestException('必须向家属说明不可逆风险（材料余量不足、二次制作仍可能失败等）');
    }
    if (dto.option === 'remake' && m.material_remaining <= 0) {
      throw new BadRequestException(`材料「${m.material_name}」已无剩余，不能安排重做，请选择退款或替代纪念品`);
    }
    if (dto.option === 'alternative' && !dto.alternative_name) {
      throw new BadRequestException('请填写替代纪念品名称');
    }
    const feeDelta = Math.round(Number(dto.fee_delta || 0) * 100) / 100;
    if (dto.option === 'refund' && feeDelta >= 0) {
      throw new BadRequestException('退款方案须填写负数退款金额（费用调整栏）');
    }
    // 同一失败纪念品只保留一条处理单（被主管/主人驳回后在原单上修订）
    const existing = await this.failureCases.findOne({
      where: { memento_id: mid }, order: { id: 'DESC' } });
    if (existing && ['applied', 'finance_done', 'closed'].includes(existing.status)) {
      throw new BadRequestException('该纪念品失败处理已闭环，不能重复提案');
    }
    if (existing && !['review_rejected', 'owner_rejected'].includes(existing.status)) {
      throw new BadRequestException('该纪念品已有处理方案在复核/确认流程中，不能重复提案');
    }
    const base: Partial<MementoFailureCase> = {
      appointment_id: a.id, memento_id: mid, artisan_id: m.artisan_id,
      material_name: m.material_name, material_on_fail: m.material_remaining,
      fail_reason: m.fail_reason,
      option: dto.option, status: 'review_pending',
      risk_notice: String(dto.risk_notice).trim(),
      option_note: dto.option_note || null,
      alternative_name: dto.option === 'alternative' ? dto.alternative_name : null,
      fee_delta: feeDelta.toFixed(2),
      review_status: 'pending', review_note: null, reviewed_at: null, supervisor_id: null,
      owner_decision: null, owner_decided_at: null, owner_note: null,
      remake_due_at: dto.option === 'remake' ? new Date(Date.now() + 3 * 86400000) : null,
      cs_id: user.sub, proposed_at: new Date(),
    };
    const c = await this.ds.transaction(async tx => {
      let saved: MementoFailureCase;
      if (existing && ['review_rejected', 'owner_rejected'].includes(existing.status)) {
        await tx.getRepository(MementoFailureCase).update(existing.id, base);
        saved = { ...existing, ...base } as MementoFailureCase;
      } else {
        saved = await tx.getRepository(MementoFailureCase).save(
          tx.getRepository(MementoFailureCase).create(base as any)) as unknown as MementoFailureCase;
      }
      const optLabel = dto.option === 'remake' ? '重做（占用剩余材料）'
        : dto.option === 'refund' ? '退款' : `替代纪念品（${dto.alternative_name}）`;
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: a.id, node_key: 'memento_case_proposed', flag: 'normal',
        title: `客服就「${m.name}」失败提出处理方案：${optLabel}，提交制作主管复核`,
        actor_id: user.sub, actor_role: user.role,
        note: `费用调整 ${feeDelta >= 0 ? '+' : ''}${feeDelta} 元；不可逆风险已告知：${dto.risk_notice}`,
        occurred_at: new Date(),
      }));
      await tx.getRepository(Message).insert(tx.getRepository(Message).create({
        appointment_id: a.id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
        content: `【失败处理待复核】${m.name} 建议${optLabel}，关联制作人 #${m.artisan_id || '?'}、剩余材料「${m.material_name}」${m.material_remaining} 份，请制作主管复核后再请主人确认。`,
      }));
      return saved;
    });
    return c;
  }

  /** 制作主管复核：通过后才向主人发出确认；驳回则客服修订重提 */
  async reviewMementoCase(caseId: number, dto: { approve: boolean; note?: string }, user: U) {
    const { c, a, m } = await this.getCaseAccessible(caseId, user);
    if (c.status !== 'review_pending') {
      throw new BadRequestException('该处理单当前不需要主管复核');
    }
    if (dto.approve) {
      // 重做方案复核时再次确认材料余量
      if (c.option === 'remake' && m.material_remaining <= 0) {
        throw new BadRequestException('剩余材料已不足，不能批准重做');
      }
      await this.ds.transaction(async tx => {
        await tx.getRepository(MementoFailureCase).update(caseId, {
          status: 'owner_pending', review_status: 'approved',
          supervisor_id: user.sub, reviewed_at: new Date(), review_note: dto.note || '同意处理方案',
        });
        await tx.getRepository(Confirmation).insert(tx.getRepository(Confirmation).create({
          appointment_id: a.id, subject: 'memento_case',
          content:
            `纪念品「${m.name}」制作失败，处理方案（已经制作主管复核）：${this.caseOptionText(c)}。` +
            `费用调整 ${Number(c.fee_delta) >= 0 ? '+' : ''}${c.fee_delta} 元。` +
            `⚠ 不可逆风险提示：${c.risk_notice} [CASE]${c.id}[/CASE]`,
          status: 'pending', requested_by: c.cs_id,
        }));
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_case_reviewed', flag: 'normal',
          title: `制作主管复核通过「${m.name}」处理方案，已请主人确认`,
          actor_id: user.sub, actor_role: user.role, note: dto.note || '同意', occurred_at: new Date(),
        }));
      });
    } else {
      await this.ds.transaction(async tx => {
        await tx.getRepository(MementoFailureCase).update(caseId, {
          status: 'review_rejected', review_status: 'rejected',
          supervisor_id: user.sub, reviewed_at: new Date(), review_note: dto.note || '请重新评估方案',
        });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_case_reviewed', flag: 'exception',
          title: `制作主管驳回「${m.name}」处理方案，客服需修订重提`,
          actor_id: user.sub, actor_role: user.role, note: dto.note, occurred_at: new Date(),
        }));
      });
    }
    return this.failureCases.findOne({ where: { id: caseId } });
  }

  private caseOptionText(c: MementoFailureCase): string {
    if (c.option === 'remake') return `重做（占用 1 份剩余材料「${c.material_name}」，承诺 3 日内交付）`;
    if (c.option === 'refund') return '退款（不再制作该纪念品）';
    return `替代纪念品：${c.alternative_name}`;
  }

  /** 主人确认/拒绝失败处理方案（由通用 respondConfirmation 在 subject=memento_case 时调用） */
  async decideMementoCase(c: MementoFailureCase, approve: boolean, note: string | undefined, user: U) {
    const a = await this.getAccessible(c.appointment_id, user);
    const m = await this.mementos.findOne({ where: { id: c.memento_id } });
    if (!m) throw new NotFoundException('纪念品单不存在');
    if (!approve) {
      await this.ds.transaction(async tx => {
        await tx.getRepository(MementoFailureCase).update(c.id, {
          status: 'owner_rejected', owner_decision: 'rejected',
          owner_id: user.sub, owner_decided_at: new Date(), owner_note: note || null,
        });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_case_owner', flag: 'exception',
          title: `主人不接受「${m.name}」处理方案，客服需重新协商`,
          actor_id: user.sub, actor_role: user.role, note: note, occurred_at: new Date(),
        }));
      });
      return;
    }
    const due = c.remake_due_at || new Date(Date.now() + 3 * 86400000);
    await this.ds.transaction(async tx => {
      // —— 1. 制作排期 / 材料同步 ——
      if (c.option === 'remake') {
        const fresh = await tx.getRepository(Memento).findOne({ where: { id: m.id } });
        if (!fresh || fresh.material_remaining <= 0) {
          throw new BadRequestException('剩余材料已不足，无法重做');
        }
        await tx.getRepository(Memento).update(m.id, {
          status: 'remake', fail_reason: null, due_at: due,
          material_remaining: fresh.material_remaining - 1,
          remake_count: fresh.remake_count + 1,
        });
      } else if (c.option === 'alternative') {
        // 替代纪念品：新建一张制作单排入制作档期，原失败单维持 failed 留痕
        await tx.getRepository(Memento).insert(tx.getRepository(Memento).create({
          appointment_id: a.id, kind: 'other', name: `替代纪念品·${c.alternative_name}`,
          status: 'pending', due_at: due, artisan_id: m.artisan_id,
          material_name: '替代材料包', material_remaining: 1,
        }));
      }

      // —— 2. 费用调整同步财务（家属确认的费用变更，财务可见入账/退款）——
      const delta = Number(c.fee_delta);
      if (delta !== 0) {
        const kind = delta < 0 ? 'refund' : 'memento';
        const title = delta < 0
          ? `纪念品失败处理退款/冲减：${m.name}`
          : `替代纪念品差价补收：${c.alternative_name || m.name}`;
        const fee = await tx.getRepository(FeeItem).save(tx.getRepository(FeeItem).create({
          appointment_id: a.id, kind, title, amount: delta.toFixed(2),
          reason: `纪念品「${m.name}」制作失败，主人确认处理方案（${this.caseOptionText(c)}）`,
          operator_id: c.cs_id, entry_type: 'change', confirm_status: 'confirmed',
        }));
        await tx.getRepository(MementoFailureCase).update(c.id, { fee_item_id: fee.id });
        const cur = Number(a.final_amount || a.quote_amount || 0);
        await tx.getRepository(Appointment).update(a.id, { final_amount: (cur + delta).toFixed(2) });
      }

      // —— 3. 状态、留痕、同步消息 ——
      await tx.getRepository(MementoFailureCase).update(c.id, {
        status: 'applied', owner_decision: 'accepted',
        owner_id: user.sub, owner_decided_at: new Date(), owner_note: note || null,
        material_after: c.option === 'remake' ? Math.max(0, m.material_remaining - 1) : m.material_remaining,
        applied_at: new Date(),
      });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: a.id, node_key: 'memento_case_applied', flag: 'resolved',
        title: `主人确认「${m.name}」处理方案：${this.caseOptionText(c)}，费用调整与制作排期已同步更新`,
        actor_id: user.sub, actor_role: user.role,
        note: `费用 ${delta >= 0 ? '+' : ''}${delta} 元${delta < 0 ? '（待财务退款）' : ''}；重做承诺交付 ${due.toLocaleString('zh-CN')}`,
        promised_at: c.option === 'remake' ? due : null, occurred_at: new Date(),
      }));
      // 同步制作人员
      await tx.getRepository(Message).insert(tx.getRepository(Message).create({
        appointment_id: a.id, sender_id: c.cs_id || 0, sender_role: 'customer_service',
        sender_name: '客服',
        content: c.option === 'remake'
          ? `【重做排期已确认】${m.name} 主人已同意重做，已占用 1 份「${c.material_name}」，承诺 ${due.toLocaleString('zh-CN')} 前交付，请按排期制作。`
          : `【失败处理已确认】${m.name} 主人选择${this.caseOptionText(c)}，请按新安排执行。`,
      }));
      // 费用变化同步财务
      if (delta !== 0) {
        await tx.getRepository(Message).insert(tx.getRepository(Message).create({
          appointment_id: a.id, sender_id: c.cs_id || 0, sender_role: 'customer_service',
          sender_name: '客服',
          content: `【费用变化同步财务】${m.name} 失败处理费用调整 ${delta >= 0 ? '+' : ''}${delta} 元，主人已确认；${delta < 0 ? '请财务安排退款。' : '请财务留意补收。'}`,
        }));
      }
    });
  }

  /** 财务确认费用变化已入账（补收已核对/退款冲减已登记）；退款也可由 /refund 自动回写 */
  async confirmCaseFinance(caseId: number, dto: { note?: string }, user: U) {
    const { c, a, m } = await this.getCaseAccessible(caseId, user);
    if (c.status !== 'applied') throw new BadRequestException('主人确认方案后才能进行财务确认');
    await this.failureCases.update(caseId, {
      status: 'finance_done', finance_id: user.sub, finance_handled_at: new Date(),
      finance_note: dto.note || null,
    });
    await this.event(a.id, 'memento_case_finance',
      `财务已确认「${m.name}」失败处理费用调整 ${c.fee_delta} 元入账`,
      { actor: user, note: dto.note });
    return this.failureCases.findOne({ where: { id: caseId } });
  }

  /** 家属评价处理结果（影响家属最终评价） */
  async rateMementoCase(caseId: number, dto: { rating: number; note?: string }, user: U) {
    const { c, a } = await this.getCaseAccessible(caseId, user);
    if (user.role !== 'owner') throw new ForbiddenException('仅家属可评价失败处理结果');
    if (!['applied', 'finance_done'].includes(c.status)) {
      throw new BadRequestException('处理方案执行完成后才能评价');
    }
    const rating = Math.round(Number(dto.rating));
    if (rating < 1 || rating > 5) throw new BadRequestException('评分须为 1-5 分');
    await this.ds.transaction(async tx => {
      await tx.getRepository(MementoFailureCase).update(caseId, {
        status: 'closed', rating, rating_note: dto.note || null, rated_at: new Date(),
      });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: a.id, node_key: 'memento_case_rated',
        title: `家属评价纪念品失败处理：${rating} 星`,
        actor_id: user.sub, actor_role: user.role, note: dto.note, occurred_at: new Date(),
      }));
    });
    return this.failureCases.findOne({ where: { id: caseId } });
  }

  /** 失败处理单队列（制作主管看复核；客服/管理者看全部；制作人看本店） */
  async listMementoCases(user: U, status?: string) {
    const appts = await this.appts.find({
      where: user.role === 'manager' ? {} : { store_id: user.store_id },
      select: { id: true, pet_name: true, code: true, store_id: true },
    });
    const ids = appts.map(x => x.id);
    if (!ids.length) return [];
    const rows = await this.failureCases.find({
      where: status ? { status: status as any } : {}, order: { id: 'DESC' }, take: 200,
    });
    const apptMap = new Map(appts.map(x => [x.id, x]));
    const userIds = new Set<number>();
    rows.forEach(c => {
      [c.artisan_id, c.cs_id, c.supervisor_id, c.owner_id, c.finance_id].forEach(id => {
        if (id) userIds.add(id);
      });
    });
    const userRows = userIds.size
      ? await this.users.find({ where: { id: In([...userIds]) } }) : [];
    const userMap = new Map(userRows.map(u => [u.id, { name: u.name, role: u.role, phone: u.phone }]));
    return rows.filter(c => ids.includes(c.appointment_id)).map(c => ({
      ...c, appointment: apptMap.get(c.appointment_id),
      artisan: c.artisan_id ? userMap.get(c.artisan_id) : null,
      cs: c.cs_id ? userMap.get(c.cs_id) : null,
      supervisor: c.supervisor_id ? userMap.get(c.supervisor_id) : null,
      owner: c.owner_id ? userMap.get(c.owner_id) : null,
      finance: c.finance_id ? userMap.get(c.finance_id) : null,
    }));
  }

  // ============ 骨灰盒寄送 ============

  async createShipment(id: number, dto: { carrier: string; tracking_no: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const s = await this.shipments.save(this.shipments.create({
      appointment_id: id, carrier: dto.carrier, tracking_no: dto.tracking_no,
      ship_at: new Date(), status: 'in_transit',
    }));
    await this.event(id, 'urn_shipped', `骨灰盒已寄出：${dto.carrier} ${dto.tracking_no}`, { actor: user });
    return s;
  }

  async shipmentAction(sid: number, action: 'delivered' | 'damage' | 'resend' | 'claim', dto: any, user: U) {
    const s = await this.shipments.findOne({ where: { id: sid } });
    if (!s) throw new NotFoundException('寄送单不存在');
    const a = await this.getAccessible(s.appointment_id, user);
    if (action === 'delivered') {
      await this.shipments.update(sid, { status: 'delivered', delivered_at: new Date() });
      await this.event(a.id, 'shipment_delivered', '骨灰盒寄达目的地', { actor: user });
    } else if (action === 'damage') {
      await this.ds.transaction(async tx => {
        await tx.getRepository(Shipment).update(sid, {
          status: 'damaged', damage_note: dto.note, media_urls: dto.media || [],
        });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'delivery_damaged', flag: 'exception',
          title: '骨灰盒寄送破损，家属已反馈', actor_id: user.sub, actor_role: user.role,
          media_urls: dto.media || [], note: dto.note, occurred_at: new Date(),
        }));
        await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
          appointment_id: a.id, trigger: 'urn_damaged', planned_at: new Date(),
          content: `骨灰盒寄送破损（${dto.note}），立即安抚家属并安排补发`,
        }));
      });
    } else if (action === 'resend') {
      await this.shipments.update(sid, { status: 'resent',
        resend_tracking_no: dto.tracking_no, damage_note: s.damage_note ? `${s.damage_note} → 已补发` : '已补发' });
      await this.event(a.id, 'urn_resent', `骨灰盒破损补发：${dto.carrier || ''} ${dto.tracking_no}`,
        { actor: user, flag: 'resolved' });
      await this.followups.save(this.followups.create({
        appointment_id: a.id, trigger: 'routine', planned_at: new Date(Date.now() + 5 * 86400000),
        content: '确认补发骨灰盒完好签收',
      }));
    } else if (action === 'claim') {
      await this.shipments.update(sid, { status: 'claimed' });
      await this.event(a.id, 'shipment_claimed', '家属确认完好签收骨灰盒', { actor: user });
    }
    return this.shipments.findOne({ where: { id: sid } });
  }

  // ============ 寄存柜位 ============

  async assignLocker(id: number, dto: { code: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const locker = await this.lockers.findOne({ where: { code: dto.code, store_id: a.store_id } });
    if (!locker) throw new NotFoundException('柜位不存在');
    if (locker.status !== 'free') throw new BadRequestException('柜位非空闲');
    const months = a.storage_months > 0 ? a.storage_months : 12;
    const expireAt = new Date(Date.now() + months * 30 * 86400000);
    await this.ds.transaction(async tx => {
      await tx.getRepository(Locker).update(locker.id, {
        status: 'occupied', appointment_id: id, occupied_since: new Date(), expire_at: expireAt,
      });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'storage_in', title: `骨灰入寄存柜位 ${locker.code}`,
        actor_id: user.sub, actor_role: user.role, note: `到期时间 ${expireAt.toLocaleString('zh-CN')}；年费 ${locker.annual_fee} 元`,
        occurred_at: new Date(),
      }));
      await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
        appointment_id: id, trigger: 'routine',
        planned_at: new Date(Date.now() + 30 * 86400000),
        content: '入柜后 30 天情感回访',
      }));
    });
    return this.lockers.findOne({ where: { id: locker.id } });
  }

  async renewLocker(lockerId: number, dto: { months: number }, user: U) {
    const locker = await this.lockers.findOne({ where: { id: lockerId } });
    if (!locker) throw new NotFoundException('柜位不存在');
    if (!locker.appointment_id) throw new BadRequestException('柜位当前未占用');
    const base = locker.expire_at && +locker.expire_at > Date.now() ? locker.expire_at : new Date();
    const newExpire = new Date(+base + dto.months * 30 * 86400000);
    const fee = Math.round((Number(locker.annual_fee) / 12) * dto.months * 100) / 100;
    await this.ds.transaction(async tx => {
      await tx.getRepository(Locker).update(lockerId, { status: 'occupied', expire_at: newExpire });
      await tx.getRepository(FeeItem).insert(tx.getRepository(FeeItem).create({
        appointment_id: locker.appointment_id, kind: 'storage', title: `柜位 ${locker.code} 续存 ${dto.months} 个月`,
        amount: String(fee), reason: '寄存续费', operator_id: user.sub,
        entry_type: 'change', confirm_status: 'confirmed',
      }));
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: locker.appointment_id, node_key: 'storage_renewed', flag: 'resolved',
        title: `柜位 ${locker.code} 续费 ${dto.months} 个月，新到期 ${newExpire.toLocaleString('zh-CN')}`,
        actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
      }));
      // 续费后关闭该单待办的到期提醒回访
      await tx.getRepository(Followup).update(
        { appointment_id: locker.appointment_id, status: 'scheduled' as any,
          trigger: In(['locker_expiring', 'locker_expired']) },
        { status: 'skipped' });
    });
    return this.lockers.findOne({ where: { id: lockerId } });
  }

  /** 定时任务：扫描柜位到期状态并生成回访（30 天内 expiring；已过期 expired 未续费） */
  async scanLockers(user?: U) {
    const lockers = await this.lockers.find({ where: { status: In(['occupied', 'expiring', 'expired']) } });
    let expiring = 0, expired = 0;
    for (const l of lockers) {
      if (!l.expire_at) continue;
      const days = (+l.expire_at - Date.now()) / 86400000;
      if (days <= 0) {
        if (l.status !== 'expired') {
          await this.lockers.update(l.id, { status: 'expired' });
          const exists = await this.followups.findOne({
            where: { appointment_id: l.appointment_id, trigger: 'locker_expired', status: 'scheduled' } });
          if (!exists) await this.followups.save(this.followups.create({
            appointment_id: l.appointment_id, trigger: 'locker_expired', planned_at: new Date(),
            content: `柜位 ${l.code} 已到期未续费，联系家属确认续存或领回`,
          }));
          expired++;
        }
      } else if (days <= 30) {
        if (l.status !== 'expiring') {
          await this.lockers.update(l.id, { status: 'expiring' });
          const exists = await this.followups.findOne({
            where: { appointment_id: l.appointment_id, trigger: 'locker_expiring', status: 'scheduled' } });
          if (!exists) await this.followups.save(this.followups.create({
            appointment_id: l.appointment_id, trigger: 'locker_expiring', planned_at: new Date(),
            content: `柜位 ${l.code} 将于 ${l.expire_at.toLocaleString('zh-CN')} 到期，提醒家属续费`,
          }));
          expiring++;
        }
      }
    }
    return { scanned: lockers.length, expiring, expired };
  }

  listLockers(user: U, status?: string) {
    const where: any = {};
    if (user.role !== 'manager') where.store_id = user.store_id;
    if (status) where.status = status;
    return this.lockers.find({ where, order: { code: 'ASC' } });
  }

  // ============ 回访 ============

  async listFollowups(user: U, status = 'scheduled') {
    if (user.role === 'owner') return [];
    const apptIds = (await this.appts.find({
      where: user.role === 'manager' ? {} : { store_id: user.store_id },
      select: { id: true },
    })).map(a => a.id);
    if (!apptIds.length) return [];
    return (await this.followups.find({
      where: { status: status as any }, order: { planned_at: 'ASC' }, take: 200,
    })).filter(f => apptIds.includes(f.appointment_id));
  }

  async completeFollowup(fid: number, dto: { emotion_note: string; content: string; skipped?: boolean }, user: U) {
    const f = await this.followups.findOne({ where: { id: fid } });
    if (!f) throw new NotFoundException('回访任务不存在');
    await this.getAccessible(f.appointment_id, user);
    await this.followups.update(fid, {
      status: dto.skipped ? 'skipped' : 'done', done_at: new Date(),
      emotion_note: dto.emotion_note, content: dto.content, cs_id: user.sub,
    });
    if (!dto.skipped) {
      await this.event(f.appointment_id, 'followup', `情感回访完成（${f.trigger}）`, {
        actor: user, note: `家属情绪：${dto.emotion_note}；${dto.content}` });
    }
  }

  // ============ 相册 / 消息 / 媒体 ============

  async addAlbum(id: number, dto: { title: string; kind: string; url: string; caption?: string }, user: U) {
    await this.getAccessible(id, user);
    const m = await this.albums.save(this.albums.create({
      appointment_id: id, title: dto.title, kind: dto.kind, url: dto.url,
      caption: dto.caption || null, uploader_id: user.sub,
    }));
    await this.event(id, 'album_add', `纪念相册新增：${dto.title}`, { actor: user });
    return m;
  }

  async postMessage(id: number, user: U, content: string) {
    await this.getAccessible(id, user);
    return this.messages.save(this.messages.create({
      appointment_id: id, sender_id: user.sub, sender_role: user.role,
      sender_name: user.name, content,
    }));
  }

  // ============ 财务 ============

  async recordPayment(id: number, dto: { amount: number; method: string; note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const p = await this.payments.save(this.payments.create({
      appointment_id: id, amount: String(Number(dto.amount).toFixed(2)),
      method: dto.method as any, status: 'paid', finance_id: user.sub, note: dto.note || null,
    }));
    await this.event(id, 'payment', `收款 ${dto.amount} 元（${dto.method}）`, { actor: user, note: dto.note });
    return p;
  }

  async refund(id: number, dto: { amount: number; reason: string; case_id?: number }, user: U) {
    const a = await this.getAccessible(id, user);
    const p = await this.payments.save(this.payments.create({
      appointment_id: id, amount: String(Number(dto.amount).toFixed(2)),
      method: 'wechat', status: 'refunded', finance_id: user.sub, note: dto.reason,
    }));
    // 若退款对应纪念品失败处理方案，回写处理单并通知相关人员；退款本身即该异常的闭环动作
    let caseId = dto.case_id ? Number(dto.case_id) : null;
    if (!caseId) {
      const c = await this.failureCases.findOne({
        where: { appointment_id: id, status: 'applied' as any }, order: { id: 'DESC' } });
      if (c && (c.option === 'refund' || Number(c.fee_delta) < 0)) caseId = c.id;
    }
    let closedByCase = false;
    if (caseId) {
      const c = await this.failureCases.findOne({ where: { id: caseId, appointment_id: id } });
      if (c && c.status === 'applied') { closedByCase = true; }
    }
    await this.event(id, 'refund', `退款 ${dto.amount} 元`,
      { actor: user, flag: closedByCase ? 'resolved' : 'exception', note: dto.reason });
    if (caseId) {
      const c = await this.failureCases.findOne({ where: { id: caseId, appointment_id: id } });
      if (c && c.status === 'applied') {
        await this.failureCases.update(caseId, {
          status: 'finance_done', finance_id: user.sub, finance_handled_at: new Date(),
          finance_note: `退款 ${dto.amount} 元（记录 #${p.id}）`,
        });
        const m = await this.mementos.findOne({ where: { id: c.memento_id } });
        await this.event(id, 'memento_case_refund',
          `财务已完成「${m?.name || '纪念品'}」失败处理退款（付款记录 #${p.id}）`,
          { actor: user });
        await this.messages.save(this.messages.create({
          appointment_id: id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
          content: `【退款同步】纪念品失败处理退款 ${dto.amount} 元已执行（记录 #${p.id}）。`,
        }));
      }
    }
    return p;
  }

  // ============ 完结 ============

  async complete(id: number, dto: { note?: string }, user: U) {
    const a = await this.getAccessible(id, user);
    this.assertStatus(a, 'fulfilled');
    const detail = await this.detail(id, user);
    const pendingFees = detail.fees.filter((f: FeeItem) => f.confirm_status === 'pending');
    if (pendingFees.length) throw new BadRequestException('仍有费用变更未经家属确认，无法完结');
    const unfinishedMementos = detail.mementos.filter((m: Memento) =>
      ['pending', 'making', 'remake'].includes(m.status));
    if (unfinishedMementos.length) throw new BadRequestException('仍有纪念品未完成（含重做中）');
    // 制作失败的纪念品必须已有主人确认的失败处理方案
    const failedMementos = detail.mementos.filter((m: Memento) => m.status === 'failed');
    const caseByMemento = new Map<number, any>((detail.memento_cases || []).map((c: any) => [c.memento_id, c]));
    for (const m of failedMementos) {
      const c = caseByMemento.get(m.id);
      if (!c || !['applied', 'finance_done', 'closed'].includes(c.status)) {
        throw new BadRequestException(`纪念品「${m.name}」制作失败，处理方案未经主人确认，无法完结`);
      }
    }
    const openCases = (detail.memento_cases || []).filter((c: any) =>
      ['review_pending', 'review_rejected', 'owner_pending', 'owner_rejected'].includes(c.status));
    if (openCases.length) throw new BadRequestException('仍有纪念品失败处理方案在复核/协商中，无法完结');
    if (detail.fee_summary.balance > 0.01) {
      throw new BadRequestException(`费用未结清，余额 ${detail.fee_summary.balance} 元`);
    }
    if (a.want_urn && !detail.locker) {
      const claimed = detail.shipments.some((s: Shipment) => s.status === 'claimed');
      if (!claimed) throw new BadRequestException('骨灰盒尚未被家属确认签收或入柜寄存');
    }
    await this.ds.transaction(async tx => {
      await tx.getRepository(Appointment).update(id, { status: 'completed', completed_at: new Date() });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'completed', title: '服务全部完结归档',
        actor_id: user.sub, actor_role: user.role, note: dto.note, occurred_at: new Date(),
      }));
      // 服务后情绪安抚回访（7 天后）
      await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
        appointment_id: id, trigger: 'post_service',
        planned_at: new Date(Date.now() + 7 * 86400000),
        content: '服务完成 7 日情绪安抚回访，询问家属近况与纪念物感受',
      }));
    });
  }

  async cancel(id: number, dto: { reason: string }, user: U) {
    const a = await this.getAccessible(id, user);
    if (['completed', 'cancelled'].includes(a.status)) throw new BadRequestException('单据已终结');
    await this.ds.transaction(async tx => {
      await tx.getRepository(Appointment).update(id, { status: 'cancelled', cancel_reason: dto.reason });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'cancelled', flag: 'exception', title: '服务取消',
        actor_id: user.sub, actor_role: user.role, note: dto.reason, occurred_at: new Date(),
      }));
    });
  }

  // ============ 管理者视图 ============

  async managerOverview(storeId?: number) {
    const where: any = {};
    if (storeId) where.store_id = Number(storeId);
    const appts = await this.appts.find({ where });
    const statusCount: Record<string, number> = {};
    let exceptions = 0, payable = 0, paid = 0;
    const breached: any[] = [];
    for (const a of appts) {
      statusCount[a.status] = (statusCount[a.status] || 0) + 1;
      payable += Number(a.final_amount || a.quote_amount || 0);
    }
    const ids = appts.map(a => a.id);
    if (ids.length) {
      const ev = await this.timeline.find({ where: { appointment_id: In(ids) } });
      // 未闭环异常按工单分别结算（异常 − 闭环），单工单不计负数后再汇总
      const perAppt: Record<number, number> = {};
      for (const e of ev) {
        const cur = perAppt[e.appointment_id] || 0;
        perAppt[e.appointment_id] = cur + (e.flag === 'exception' ? 1 : e.flag === 'resolved' ? -1 : 0);
      }
      exceptions = Object.values(perAppt).reduce((s, n) => s + Math.max(0, n), 0);
      const pays = await this.payments.find({ where: { appointment_id: In(ids) } });
      paid = pays.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
        - pays.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
      // 承诺时间违约：有 promised_at 且超过 60 分钟仍无对应后续实际节点
      for (const e of ev) {
        if (e.promised_at && e.flag !== 'resolved' && +e.promised_at < Date.now() - 3600000
          && !['pickup_delay', 'ceremony_reschedule'].includes(e.node_key)) {
          breached.push({ appointment_id: e.appointment_id, node: e.node_key,
            title: e.title, promised_at: e.promised_at });
        }
      }
    }
    // 失败/重做中且尚未被已闭环处理方案覆盖的纪念品，才算待处理
    const [unhandledFailed, openCaseRows] = await Promise.all([
      (async () => {
        const rows = await this.mementos.find({
          where: { status: In(['failed', 'remake']) }, select: { id: true, appointment_id: true } });
        if (!rows.length) return 0;
        const handled = await this.failureCases.find({
          where: { status: In(['applied', 'finance_done', 'closed']) }, select: { memento_id: true } });
        const handledIds = new Set(handled.map(c => c.memento_id));
        const apptIdSet = new Set(ids);
        return rows.filter(r => apptIdSet.has(r.appointment_id) && !handledIds.has(r.id)).length;
      })(),
      this.failureCases.find(),
    ]);
    const pendingCaseReview = openCaseRows.filter(c =>
      ids.includes(c.appointment_id) && ['review_pending', 'review_rejected'].includes(c.status)).length;
    const pendingOwnerCases = openCaseRows.filter(c =>
      ids.includes(c.appointment_id) && ['owner_pending', 'owner_rejected'].includes(c.status)).length;
    const [stores, expiringLockers, pendingFees] = await Promise.all([
      this.stores.find(),
      this.lockers.count({ where: { status: In(['expiring', 'expired']) } }),
      this.fees.count({ where: { entry_type: 'change', confirm_status: 'pending' } }),
    ]);
    return {
      total: appts.length, status_count: statusCount,
      open_exceptions: exceptions, payable_total: payable, paid_total: paid,
      breached_promises: breached.slice(0, 50),
      expiring_lockers: expiringLockers, failed_mementos: unhandledFailed, pending_fees: pendingFees,
      memento_cases_pending_review: pendingCaseReview,
      memento_cases_pending_owner: pendingOwnerCases,
      stores,
    };
  }

  async resources(storeId?: number) {
    const sid = storeId ? Number(storeId) : undefined;
    const [furnaces, rooms, cold, lockers] = await Promise.all([
      this.furnaces.find({ where: sid ? { store_id: sid } : {}, order: { start_at: 'DESC' }, take: 100 }),
      this.rooms.find({ where: sid ? { store_id: sid } : {}, order: { start_at: 'DESC' }, take: 100 }),
      this.cold.find({ where: sid ? { store_id: sid } : {} }),
      this.lockers.find({ where: sid ? { store_id: sid } : {}, order: { code: 'ASC' } }),
    ]);
    return { furnaces, rooms, cold, lockers };
  }

  // 员工/医院/目录
  storesList() { return this.stores.find(); }

  async quotePreview(id: number, dto: any, user: U) {
    const a = await this.getAccessible(id, user);
    return suggestQuote({ ...a, ...dto } as any);
  }

  listStaff(role?: string, storeId?: number) {
    const where: any = {};
    if (role) where.role = role;
    if (storeId) where.store_id = Number(storeId);
    return this.users.find({ where, select: ['id', 'name', 'username', 'role', 'phone', 'store_id'] as any });
  }
  listHospitals(storeId?: number) {
    return this.hospitals.find({ where: storeId ? { store_id: Number(storeId) } : {} });
  }
  async createHospital(dto: any, user: U) {
    return this.hospitals.save(this.hospitals.create({
      name: dto.name, contact: dto.contact, phone: dto.phone,
      store_id: Number(dto.store_id || user.store_id),
    }));
  }
}
