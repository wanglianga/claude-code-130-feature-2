import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
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
      mementos, failureCases, shipments, locker, followups, album, payments, messages,
    ] = await Promise.all([
      this.timeline.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.fees.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.confirms.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.furnaces.find({ where: { appointment_id: id } }),
      this.rooms.find({ where: { appointment_id: id } }),
      this.cold.find({ where: { appointment_id: id } }),
      this.certs.findOne({ where: { appointment_id: id } }),
      this.mementos.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.failureCases.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.shipments.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.lockers.findOne({ where: { appointment_id: id } }),
      this.followups.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.albums.find({ where: { appointment_id: id }, order: { id: 'DESC' } }),
      this.payments.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
      this.messages.find({ where: { appointment_id: id }, order: { id: 'ASC' } }),
    ]);
    const owner = await this.users.findOne({ where: { id: a.owner_id } });
    // 失败处理工单涉及的制作人/客服/主管姓名一并带出，便于各岗位查看
    const staffIds = new Set<number>();
    failureCases.forEach(c => {
      [c.artisan_id, c.cs_id, c.supervisor_id].forEach(x => x && staffIds.add(x));
    });
    const staffRows = staffIds.size
      ? await this.users.find({ where: { id: In([...staffIds]) },
        select: ['id', 'name', 'role'] as any })
      : [];
    const staffName = (uid?: number | null) => staffRows.find(u => u.id === uid)?.name || (uid ? `#${uid}` : null);
    const failure_cases = failureCases.map(c => ({
      ...c,
      artisan_name: staffName(c.artisan_id),
      cs_name: staffName(c.cs_id),
      supervisor_name: staffName(c.supervisor_id),
    }));
    const quoteTotal = fees.filter(f => f.entry_type === 'base')
      .reduce((s, f) => s + Number(f.amount), 0);
    const confirmedChange = fees.filter(f => f.entry_type === 'change' && f.confirm_status === 'confirmed')
      .reduce((s, f) => s + Number(f.amount), 0);
    const pendingChange = fees.filter(f => f.entry_type === 'change' && f.confirm_status === 'pending')
      .reduce((s, f) => s + Number(f.amount), 0);
    const paid = payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);
    const refunded = payments.filter(p => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
    const openExceptions = timeline.filter(t => t.flag === 'exception').length
      - timeline.filter(t => t.flag === 'resolved').length;
    return {
      appointment: a,
      owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone } : null,
      timeline, fees, confirmations, furnaces, rooms, cold_storage: coldRows,
      certificate: cert, mementos, failure_cases, shipments, locker, followups, album, payments, messages,
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
      // 纪念品制作单
      const mkMemento = (kind: string, name: string) =>
        m.getRepository(Memento).insert(m.getRepository(Memento).create({
          appointment_id: id, kind, name, status: 'pending',
          due_at: furnaceAt, artisan_id: dto.artisan_id || null,
        }));
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
    if (c.subject === 'memento_failure') {
      // 纪念品失败处理方案：须主人本人确认 → 执行费用/材料/排期同步
      if (user.role !== 'owner' || (await this.appts.findOne({ where: { id } }))?.owner_id !== user.sub) {
        throw new ForbiddenException('失败处理方案须由宠物主人本人确认');
      }
      // 纪念品失败处理方案：主人确认 → 执行费用/材料/排期同步
      const marker = c.content.match(/\[CASE\](\d+)\[\/CASE\]/);
      const fc = marker
        ? await this.failureCases.findOne({ where: { id: Number(marker[1]), appointment_id: id } })
        : null;
      if (!fc) throw new NotFoundException('失败处理工单不存在');
      if (fc.status !== 'proposed') {
        throw new BadRequestException('该方案已处理或客服已重新拟定，请确认最新方案');
      }
      await this.applyFailureDecision(fc, dto.approve, dto.note || null, user);
      await this.confirms.update(cid, {
        status: dto.approve ? 'confirmed' : 'rejected',
        confirmed_at: new Date(), reply_note: dto.note || null,
      });
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

  async mementoAction(mid: number, action: 'start' | 'fail' | 'remake' | 'done', dto: any, user: U) {
    const m = await this.mementos.findOne({ where: { id: mid } });
    if (!m) throw new NotFoundException('纪念品单不存在');
    const a = await this.getAccessible(m.appointment_id, user);
    if (action === 'start') {
      await this.mementos.update(mid, { status: 'making', artisan_id: user.sub });
      await this.event(a.id, 'memento_start', `纪念品「${m.name}」开始制作`, { actor: user });
    } else if (action === 'fail') {
      // 失败立案：平台关联制作人、剩余可用材料、主人选择，并立即触发客服关怀
      await this.ds.transaction(async tx => {
        const artisanId = m.artisan_id || user.sub;
        await tx.getRepository(Memento).update(mid, {
          status: 'failed', fail_reason: dto.reason, artisan_id: artisanId,
          remaining_materials: dto.remaining_materials || null,
          owner_choice: dto.owner_choice || null,
        });
        const fc = await tx.getRepository(MementoFailureCase).insert(tx.getRepository(MementoFailureCase).create({
          appointment_id: a.id, memento_id: mid, artisan_id: artisanId,
          kind: m.kind, memento_name: m.name, fail_reason: dto.reason,
          remaining_materials: dto.remaining_materials || null,
          owner_choice: dto.owner_choice || null,
          remaining_attempts: Math.max(0, Number(dto.remaining_attempts || 0)),
          status: 'open',
        }));
        const caseId = (fc.identifiers?.[0]?.id as number) || 0;
        await tx.getRepository(Memento).update(mid, { failure_case_id: caseId });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_failed', flag: 'exception',
          title: `纪念品「${m.name}」制作失败，已立失败处理工单，等待客服拟定方案`,
          actor_id: user.sub, actor_role: user.role,
          note: [
            dto.reason ? `原因：${dto.reason}` : '',
            dto.remaining_materials ? `剩余可用材料：${dto.remaining_materials}` : '',
            dto.owner_choice ? `主人选择：${dto.owner_choice}` : '',
          ].filter(Boolean).join('；'),
          occurred_at: new Date(),
        }));
        // 纪念品失败 → 生成专项关怀回访，改变客服回访节奏
        await tx.getRepository(Followup).insert(tx.getRepository(Followup).create({
          appointment_id: a.id, trigger: 'memento_failed', planned_at: new Date(),
          content: `纪念品「${m.name}」制作失败（${dto.reason || '原因待补充'}），立即联系家属说明并安抚情绪`,
        }));
        await tx.getRepository(Message).insert(tx.getRepository(Message).create({
          appointment_id: a.id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
          content: `【纪念品失败】「${m.name}」制作失败：${dto.reason || '原因待补充'}。`
            + `剩余材料：${dto.remaining_materials || '待登记'}。已立失败处理工单，请客服尽快联系家属并拟定重做/退款/替代方案。`,
        }));
      });
    } else if (action === 'remake') {
      // 兼容旧入口：若已立失败处理工单，必须走「客服拟方案→主人确认」流程
      if (m.failure_case_id) {
        throw new BadRequestException('该纪念品已立失败处理工单，须由客服拟定重做方案并经主人确认后安排');
      }
      await this.mementos.update(mid, { status: 'remake', fail_reason: null,
        due_at: new Date(Date.now() + 3 * 86400000) });
      await this.event(a.id, 'memento_remake', `纪念品「${m.name}」安排重做，承诺 3 日内交付`,
        { actor: user, flag: 'resolved' });
    } else if (action === 'done') {
      await this.ds.transaction(async tx => {
        await tx.getRepository(Memento).update(mid,
          { status: 'done', finished_at: new Date(), media_urls: dto.media || [] });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: a.id, node_key: 'memento_done',
          title: `纪念品「${m.name}」制作完成`,
          actor_id: user.sub, actor_role: user.role, media_urls: dto.media || [], occurred_at: new Date(),
        }));
        // 重做/替代成品完成 → 失败处理进入制作主管复核环节
        if (m.failure_case_id) {
          const fc = await tx.getRepository(MementoFailureCase).findOne({ where: { id: m.failure_case_id } });
          if (fc && ['remake_confirmed', 'alternative_confirmed'].includes(fc.status)) {
            await tx.getRepository(MementoFailureCase).update(fc.id, { status: 'reviewing' });
            await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
              appointment_id: a.id, node_key: 'memento_review', flag: 'exception',
              title: `失败处理成品「${fc.memento_name}」已交付制作，等待制作主管复核`,
              actor_id: user.sub, actor_role: user.role, occurred_at: new Date(),
            }));
            await tx.getRepository(Message).insert(tx.getRepository(Message).create({
              appointment_id: a.id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
              content: `【待复核】「${fc.memento_name}」失败处理后的${fc.resolution === 'alternative' ? '替代纪念品' : '重做件'}已制作完成，请制作主管复核质量。`,
            }));
          }
        }
      });
    }
    return this.mementos.findOne({ where: { id: mid } });
  }

  // ============ 纪念品失败处理：客服拟方案 / 主人确认执行 / 主管复核 / 家属评价 ============

  /** 客服拟定失败处理方案：重做 / 退款 / 替代纪念品 */
  async proposeFailureResolution(caseId: number, dto: any, user: U) {
    const fc = await this.failureCases.findOne({ where: { id: caseId } });
    if (!fc) throw new NotFoundException('失败处理工单不存在');
    const a = await this.getAccessible(fc.appointment_id, user);
    if (!['open', 'owner_rejected', 'proposed'].includes(fc.status)) {
      throw new BadRequestException('当前处理阶段不允许重新拟定方案');
    }
    const resolution = dto.resolution as 'remake' | 'refund' | 'alternative';
    if (!['remake', 'refund', 'alternative'].includes(resolution)) {
      throw new BadRequestException('处理方案必须是重做 / 退款 / 替代纪念品之一');
    }
    const feeAdj = Math.round(Number(dto.fee_adjustment || 0) * 100) / 100;
    const promisedAt = dto.promised_at ? new Date(dto.promised_at) : null;
    const risk = (dto.irreversible_risk || '').trim();
    const consume = (dto.material_consume || '').trim();

    if (resolution === 'remake') {
      if (fc.remaining_attempts <= 0) {
        throw new BadRequestException('剩余材料已不足以重做，请改选退款或替代纪念品');
      }
      if (!promisedAt) throw new BadRequestException('重做须给出承诺交付时间（制作排期）');
      if (!risk) throw new BadRequestException('重做会占用仅剩的纪念材料，必须向主人说明不可逆风险');
      if (!consume) throw new BadRequestException('须说明重做将占用的剩余材料');
    }
    if (resolution === 'alternative') {
      if (!(dto.alternative_name || '').trim()) throw new BadRequestException('请填写替代纪念品名称');
      if (!promisedAt) throw new BadRequestException('替代纪念品须给出承诺交付时间');
    }
    if (resolution === 'refund' && feeAdj >= 0) {
      throw new BadRequestException('退款方案的费用调整应为负数（退/减金额）');
    }

    return this.ds.transaction(async tx => {
      // 重新拟方案：作废本案旧的待确认事项（按 [CASE] 标记精确定位），只保留最新一条
      await tx.createQueryBuilder()
        .update(Confirmation)
        .set({ status: 'rejected', confirmed_at: new Date(), reply_note: '客服已重新拟定方案' })
        .where('appointment_id = :aid', { aid: a.id })
        .andWhere('subject = :s', { s: 'memento_failure' })
        .andWhere('status = :st', { st: 'pending' })
        .andWhere('content LIKE :m', { m: `%[CASE]${caseId}[/CASE]%` })
        .execute();
      await tx.getRepository(MementoFailureCase).update(caseId, {
        cs_id: user.sub, status: 'proposed', resolution,
        fee_adjustment: feeAdj.toFixed(2), fee_title: dto.fee_title || null,
        promised_at: promisedAt, irreversible_risk: risk || null,
        material_consume: consume || null,
        alternative_name: resolution === 'alternative' ? dto.alternative_name.trim() : null,
        proposal_note: dto.note || null, proposed_at: new Date(),
        // 重拟时清掉上一轮复核结论
        review_result: null, review_note: null,
      });
      const resLabel = resolution === 'remake' ? '使用剩余材料重新制作'
        : resolution === 'refund' ? '退回纪念品费用、不再制作'
        : `改做替代纪念品「${dto.alternative_name.trim()}」`;
      const lines = [
        `纪念品「${fc.memento_name}」制作失败，客服提出处理方案：${resLabel}。`,
        feeAdj !== 0 ? `费用调整：${feeAdj > 0 ? '+' : ''}${feeAdj} 元（确认后同步财务并计入最终费用）。` : '费用不做调整。',
        promisedAt ? `承诺交付：${promisedAt.toLocaleString('zh-CN')}（确认后同步制作排期）。` : '',
        consume ? `重做将占用剩余材料：${consume}。` : '',
        risk ? `⚠ 不可逆风险：${risk}` : '',
      ].filter(Boolean);
      await tx.getRepository(Confirmation).insert(tx.getRepository(Confirmation).create({
        appointment_id: a.id, subject: 'memento_failure',
        content: `${lines.join('\n')} [CASE]${caseId}[/CASE]`,
        status: 'pending', requested_by: user.sub,
      }));
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: a.id, node_key: 'memento_resolution', flag: 'exception',
        title: `客服拟定失败处理方案（${resolution === 'remake' ? '重做' : resolution === 'refund' ? '退款' : '替代'}），待主人确认`,
        actor_id: user.sub, actor_role: user.role,
        note: lines.join('；'), promised_at: promisedAt, occurred_at: new Date(),
      }));
      await tx.getRepository(Message).insert(tx.getRepository(Message).create({
        appointment_id: a.id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
        content: `【待家属确认】「${fc.memento_name}」失败处理方案：${resLabel}`
          + `${feeAdj !== 0 ? `，费用 ${feeAdj > 0 ? '+' : ''}${feeAdj} 元` : ''}。请家属在工单中确认。`,
      }));
    });
  }

  /** 主人确认/拒绝失败处理方案（由通用确认应答在 subject=memento_failure 时转入） */
  async applyFailureDecision(fc: MementoFailureCase, approve: boolean, note: string | null, user: U) {
    const id = fc.appointment_id;
    if (!approve) {
      await this.ds.transaction(async tx => {
        await tx.getRepository(MementoFailureCase).update(fc.id, { status: 'owner_rejected' });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: id, node_key: 'memento_resolution', flag: 'exception',
          title: `主人拒绝「${fc.memento_name}」的处理方案，客服需重新拟定`,
          actor_id: user.sub, actor_role: user.role, note: note || '', occurred_at: new Date(),
        }));
      });
      return;
    }
    const now = new Date();
    await this.ds.transaction(async tx => {
      const feeAdj = Number(fc.fee_adjustment || 0);
      let feeItemId: number | null = null;
      // 1) 费用调整：主人在方案确认中已一并同意，直接落已确认费用项并更新最终费用（同步财务）
      if (feeAdj !== 0) {
        const kindMap = { remake: 'memento', refund: 'refund', alternative: 'memento' } as const;
        const titleMap = {
          remake: `「${fc.memento_name}」重做费用调整`,
          refund: `「${fc.memento_name}」失败退款冲减`,
          alternative: `「${fc.memento_name}」改为替代纪念品差价`,
        } as const;
        const ins = await tx.getRepository(FeeItem).insert(tx.getRepository(FeeItem).create({
          appointment_id: id, kind: kindMap[fc.resolution!],
          title: fc.fee_title || titleMap[fc.resolution!],
          amount: feeAdj.toFixed(2),
          reason: `纪念品失败处理（${fc.resolution}），家属已于 ${now.toLocaleString('zh-CN')} 确认`,
          operator_id: fc.cs_id, entry_type: 'change', confirm_status: 'confirmed',
        }));
        feeItemId = ins.identifiers?.[0]?.id as number;
        const appt = await tx.getRepository(Appointment).findOne({ where: { id } });
        const cur = Number(appt?.final_amount || appt?.quote_amount || 0);
        await tx.getRepository(Appointment).update(id, { final_amount: (cur + feeAdj).toFixed(2) });
      }

      // 2) 按方案处理制作单（材料占用 + 制作排期同步）
      let nextStatus: MementoFailureCase['status'] = 'reviewing';
      if (fc.resolution === 'remake') {
        const left = Math.max(0, fc.remaining_attempts - 1); // 重做占用一份剩余材料
        const curM = await tx.getRepository(Memento).findOne({ where: { id: fc.memento_id } });
        await tx.getRepository(Memento).update(fc.memento_id, {
          status: 'remake', fail_reason: null, due_at: fc.promised_at,
          remake_material_used: (curM?.remake_material_used || 0) + 1,
          remaining_materials: fc.material_consume
            ? `已扣减重做用料（${fc.material_consume}）；剩余可重做 ${left} 次`
            : `剩余可重做 ${left} 次`,
        });
        await tx.getRepository(MementoFailureCase).update(fc.id, { remaining_attempts: left });
        nextStatus = 'remake_confirmed';
      } else if (fc.resolution === 'refund') {
        // 退款：纪念品不再交付；不产生重新制作，免制作复核
        await tx.getRepository(Memento).update(fc.memento_id, { status: 'refunded' });
        nextStatus = 'reviewed';
      } else {
        // 替代纪念品：原单标记 replaced，新建一张制作单并排入档期
        const newM = await tx.getRepository(Memento).insert(tx.getRepository(Memento).create({
          appointment_id: id, kind: 'other', name: fc.alternative_name!,
          status: 'pending', due_at: fc.promised_at, artisan_id: fc.artisan_id,
          failure_case_id: fc.id,
        }));
        const newId = newM.identifiers?.[0]?.id as number;
        await tx.getRepository(Memento).update(fc.memento_id, { status: 'replaced' });
        await tx.getRepository(MementoFailureCase).update(fc.id, { replacement_memento_id: newId });
        nextStatus = 'alternative_confirmed';
      }

      await tx.getRepository(MementoFailureCase).update(fc.id, {
        status: nextStatus, owner_confirmed_at: now, fee_item_id: feeItemId, executed_at: now,
        ...(fc.resolution === 'refund'
          ? { review_result: 'approved' as const, review_note: '退款方案不涉及重新制作，免制作质量复核', reviewed_at: now }
          : {}),
      });

      const resText = fc.resolution === 'remake' ? '重做' : fc.resolution === 'refund' ? '退款' : '替代纪念品';
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: id, node_key: 'memento_resolution', flag: 'resolved',
        title: `主人确认「${fc.memento_name}」${resText}方案，费用调整与制作排期已同步`,
        actor_id: user.sub, actor_role: user.role,
        note: [
          feeAdj !== 0 ? `费用 ${feeAdj > 0 ? '+' : ''}${feeAdj} 元已入账并同步财务` : '费用无变化',
          fc.promised_at && fc.resolution !== 'refund' ? `制作排期/承诺交付：${fc.promised_at.toLocaleString('zh-CN')}` : '',
          fc.resolution === 'remake' && fc.material_consume ? `已占用剩余材料：${fc.material_consume}` : '',
          note || '',
        ].filter(Boolean).join('；'),
        promised_at: fc.resolution === 'refund' ? null : fc.promised_at,
        occurred_at: now,
      }));
      await tx.getRepository(Message).insert(tx.getRepository(Message).create({
        appointment_id: id, sender_id: user.sub, sender_role: user.role, sender_name: user.name,
        content: `【方案已确认】「${fc.memento_name}」按${resText}处理。`
          + `${feeAdj !== 0 ? `费用调整 ${feeAdj > 0 ? '+' : ''}${feeAdj} 元已同步财务；` : ''}`
          + (fc.resolution === 'remake' ? '制作人员请按新承诺时间使用剩余材料重做；'
            : fc.resolution === 'alternative' ? `制作人员请安排替代纪念品「${fc.alternative_name}」；`
            : '财务请据费用调整办理退款。'),
      }));
    });
  }

  /** 制作主管复核失败处理成品 */
  async reviewFailureCase(caseId: number, dto: { approve: boolean; note?: string }, user: U) {
    const fc = await this.failureCases.findOne({ where: { id: caseId } });
    if (!fc) throw new NotFoundException('失败处理工单不存在');
    await this.getAccessible(fc.appointment_id, user);
    if (fc.status !== 'reviewing') throw new BadRequestException('该工单当前不处于待主管复核阶段');
    await this.ds.transaction(async tx => {
      if (dto.approve) {
        await tx.getRepository(MementoFailureCase).update(caseId, {
          status: 'reviewed', supervisor_id: user.sub, reviewed_at: new Date(),
          review_result: 'approved', review_note: dto.note || '复核通过',
        });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: fc.appointment_id, node_key: 'memento_review', flag: 'resolved',
          title: `制作主管复核通过「${fc.memento_name}」失败处理成品，可交付家属并邀请评价`,
          actor_id: user.sub, actor_role: user.role, note: dto.note || '', occurred_at: new Date(),
        }));
      } else {
        // 退回：回到对应已确认制作阶段，制作人员需再次制作（再次占用材料）
        const back: MementoFailureCase['status'] =
          fc.resolution === 'alternative' ? 'alternative_confirmed' : 'remake_confirmed';
        await tx.getRepository(MementoFailureCase).update(caseId, {
          status: back, supervisor_id: user.sub, reviewed_at: new Date(),
          review_result: 'rejected', review_note: dto.note || '复核不通过，退回重新制作',
        });
        const mid = fc.replacement_memento_id || fc.memento_id;
        await tx.getRepository(Memento).update(mid, { status: 'remake' });
        await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
          appointment_id: fc.appointment_id, node_key: 'memento_review', flag: 'exception',
          title: `制作主管退回「${fc.memento_name}」成品，要求重新制作`,
          actor_id: user.sub, actor_role: user.role, note: dto.note || '', occurred_at: new Date(),
        }));
      }
    });
  }

  /** 家属对失败处理结果评价（1~5 星），评价后结案 */
  async rateFailureCase(caseId: number, dto: { rating: number; note?: string }, user: U) {
    const fc = await this.failureCases.findOne({ where: { id: caseId } });
    if (!fc) throw new NotFoundException('失败处理工单不存在');
    await this.getAccessible(fc.appointment_id, user);
    if (fc.status !== 'reviewed') throw new BadRequestException('须经制作主管复核通过后，家属才能评价');
    const rating = Math.min(5, Math.max(1, Number(dto.rating)));
    if (!rating) throw new BadRequestException('请给出 1~5 星评价');
    await this.ds.transaction(async tx => {
      await tx.getRepository(MementoFailureCase).update(caseId, {
        status: 'closed', rating, rating_note: dto.note || null, rated_at: new Date(),
      });
      await tx.getRepository(TimelineEvent).insert(tx.getRepository(TimelineEvent).create({
        appointment_id: fc.appointment_id, node_key: 'memento_rated', flag: 'resolved',
        title: `家属评价「${fc.memento_name}」失败处理结果：${rating} 星`,
        actor_id: user.sub, actor_role: user.role, note: dto.note || '', occurred_at: new Date(),
      }));
    });
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

  async refund(id: number, dto: { amount: number; reason: string }, user: U) {
    const a = await this.getAccessible(id, user);
    const p = await this.payments.save(this.payments.create({
      appointment_id: id, amount: String(Number(dto.amount).toFixed(2)),
      method: 'wechat', status: 'refunded', finance_id: user.sub, note: dto.reason,
    }));
    await this.event(id, 'refund', `退款 ${dto.amount} 元`, { actor: user, flag: 'exception', note: dto.reason });
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
      ['pending', 'making', 'failed', 'remake'].includes(m.status));
    if (unfinishedMementos.length) throw new BadRequestException('仍有纪念品未完成（含失败待重做）');
    // 失败处理必须闭环：方案已执行、制作主管复核通过、家属已评价
    const openCases = (detail.failure_cases || []).filter((c: MementoFailureCase) => c.status !== 'closed');
    if (openCases.length) {
      const tip = openCases.map((c: MementoFailureCase) => {
        const stage: Record<string, string> = {
          open: '待客服拟方案', proposed: '待主人确认方案', owner_rejected: '主人拒绝待重拟',
          remake_confirmed: '重做中', alternative_confirmed: '替代纪念品制作中',
          reviewing: '待制作主管复核', reviewed: '待家属评价', refund_confirmed: '退款执行中',
        };
        return `「${c.memento_name}」${stage[c.status] || c.status}`;
      }).join('；');
      throw new BadRequestException(`仍有纪念品失败处理未闭环：${tip}`);
    }
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
      exceptions = ev.filter(e => e.flag === 'exception').length
        - ev.filter(e => e.flag === 'resolved').length;
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
    const [stores, expiringLockers, failedMementos, pendingFees, openFailureCases, reviewPending, ratingRows] = await Promise.all([
      this.stores.find(),
      this.lockers.count({ where: { status: In(['expiring', 'expired']) } }),
      this.mementos.count({ where: { status: In(['failed', 'remake']) } }),
      this.fees.count({ where: { entry_type: 'change', confirm_status: 'pending' } }),
      this.failureCases.count({ where: { status: In(['open', 'proposed', 'owner_rejected',
        'remake_confirmed', 'alternative_confirmed', 'reviewing', 'reviewed', 'refund_confirmed']) } }),
      this.failureCases.count({ where: { status: 'reviewing' } }),
      this.failureCases.find({ where: { rating: Not(IsNull()) }, select: { rating: true } as any }),
    ]);
    const ratings = ratingRows.map(r => Number(r.rating)).filter(n => n > 0);
    const avgRating = ratings.length
      ? Math.round((ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10) / 10 : null;
    return {
      total: appts.length, status_count: statusCount,
      open_exceptions: exceptions, payable_total: payable, paid_total: paid,
      breached_promises: breached.slice(0, 50),
      expiring_lockers: expiringLockers, failed_mementos: failedMementos, pending_fees: pendingFees,
      open_failure_cases: openFailureCases, failure_review_pending: reviewPending,
      memento_rating_avg: avgRating, memento_rating_count: ratings.length,
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
