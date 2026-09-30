/**
 * 端到端业务演示（直接走 HTTP API）。
 * 前置：MariaDB 已启动、已 npm run seed、后端已在 4000 端口运行。
 * 运行：npm run demo
 *
 * 覆盖：主人下单（含转介/全部服务选项）→ 客服方案+家属确认 → 调度
 * → 交通延误 → 接运（体重不符自动补差）→ 冷藏 → 家属改期 → 视频见证
 * → 告别 → 火化证明 → 纪念品失败处理（重做 / 退款 / 替代，含材料占用、
 * 不可逆风险、费用同步财务、制作排期、制作主管复核、家属评价）
 * → 骨灰盒寄送破损/补发 → 柜位入存
 * → 费用与收款 → 完结 → 7日安抚回访 + 柜位到期扫描。
 */
import 'reflect-metadata';

const BASE = process.env.API_BASE || 'http://127.0.0.1:4000';
let token = '';
const log = (...a: any[]) => console.log(...a);

async function api(method: string, path: string, body?: any, who?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message ? JSON.stringify(data.message) : res.status;
    throw new Error(`${who || path} → ${res.status} ${msg}`);
  }
  return data;
}

async function login(u: string) {
  const r: any = await api('POST', '/auth/login', { username: u, password: '123456' });
  token = r.token;
  log(`\n=== 登录：${r.user.name}（${r.user.role}）===`);
  return r.user;
}

async function main() {
  // 1. 主人下单
  await login('owner1');
  const appt: any = await api('POST', '/api/appointments', {
    store_id: 1, hospital_id: 1,
    pet_name: '布丁', pet_type: 'cat', pet_breed: '英国短毛猫', weight_kg: 4.2,
    death_time: new Date(Date.now() - 3600e3).toISOString(),
    need_pickup: true, pickup_address: '本市春风小区 3 栋',
    want_ceremony: true, private_cremation: true, want_urn: true,
    pawprint_hair: true, photo_video: true, storage_months: 0,
  }, '主人下单');
  const id = appt.id;
  log(`预约单 ${appt.code} #${id} 已提交`);

  // 2. 客服确认方案
  await login('cs1');
  await api('POST', `/api/appointments/${id}/confirm-plan`, {}, '客服确认方案');
  const d1: any = await api('GET', `/api/appointments/${id}`, {});
  log(`方案报价：${d1.fee_summary.quote_total} 元`);

  // 3. 家属确认方案
  await login('owner1');
  const planC = d1.confirmations.find((c: any) => c.subject === 'plan');
  await api('POST', `/api/appointments/${id}/confirmations/${planC.id}/respond`,
    { approve: true, note: '同意方案，请温柔对待布丁' });

  // 4. 客服调度（约 2 小时后接运、明天告别与火化）
  await login('cs1');
  const h = (n: number) => new Date(Date.now() + n * 3600e3).toISOString();
  await api('POST', `/api/appointments/${id}/dispatch`, {
    driver_id: 5, ceremonialist_id: 7, cremator_id: 9,
    pickup_at: h(2), ceremony_at: h(20), furnace_at: h(22),
    furnace_name: '1号火化炉', room_name: '宁静厅(1号店)',
  }, '客服调度');
  log('调度完成：接送员-老赵 / 冷藏位 / 1号火化炉 / 宁静厅 / 纪念品');

  // 5. 接送途中交通延误
  await login('driver1');
  await api('POST', `/api/appointments/${id}/driver-delay`,
    { minutes: 40, reason: '晚高峰高架事故拥堵' }, '交通延误');
  log('接送员上报延误 40 分钟，承诺接运时间已顺延并通知家属');

  // 6. 接运：实际体重 5.0kg（与登记 4.2kg 不符）→ 自动补差
  await api('POST', `/api/appointments/${id}/pickup`, {
    actual_weight_kg: 5.0, media: ['https://example.com/photos/pickup-01.jpg'],
    note: '主人当面交接，宠物安卧在毯中',
  }, '接运复称');
  const d2: any = await api('GET', `/api/appointments/${id}`, {});
  const pendingFee = d2.fees.find((f: any) => f.confirm_status === 'pending');
  log(`体重不符产生费用变更：${pendingFee.title} ${pendingFee.amount} 元，待家属确认`);

  // 7. 入冷藏
  await api('POST', `/api/appointments/${id}/cold-in`, {
    media: ['https://example.com/photos/cold-01.jpg'], note: '冷藏温度 4℃',
  }, '入冷藏');

  // 8. 家属确认补差
  await login('owner1');
  const feeC = d2.confirmations.find((c: any) => c.subject === 'fee_change');
  await api('POST', `/api/appointments/${id}/confirmations/${feeC.id}/respond`,
    { approve: true }, '家属确认补差');

  // 9. 家属申请更改仪式时间
  await api('POST', `/api/appointments/${id}/reschedule`,
    { new_time: h(21), reason: '外地亲属想赶回来参加告别' }, '家属改期');

  // 10. 家属要求视频见证
  await api('POST', `/api/appointments/${id}/video-witness`,
    { note: '我身体不便到现场，希望全程视频送别' }, '视频见证');

  // 11. 客服同意改期
  await login('cs1');
  const d3: any = await api('GET', `/api/appointments/${id}`, {});
  const rsc = d3.confirmations.filter((c: any) => c.subject === 'ceremony_time').pop();
  await api('POST', `/api/appointments/${id}/reschedule/${rsc.id}/approve`,
    { approve: true, note: '已协调礼仪师与告别室' }, '客服同意改期');
  log('改期成功，告别室档期已重排');

  // 12. 告别仪式
  await login('rite1');
  await api('POST', `/api/appointments/${id}/farewell-start`,
    { media: ['https://example.com/photos/farewell-01.jpg'], note: '家属视频接入正常' });
  await api('POST', `/api/appointments/${id}/farewell-end`,
    { media: ['https://example.com/photos/farewell-02.jpg'], note: '仪式安详完成' });

  // 13. 火化（未确认费用会被拦截；此处已确认）
  await login('fire1');
  await api('POST', `/api/appointments/${id}/cremation-start`, { note: '单独炉火化' });
  await api('POST', `/api/appointments/${id}/cremation-complete`, {
    media: ['https://example.com/photos/crem-01.jpg', 'https://example.com/photos/crem-02.jpg'],
    note: '视频见证全程录制',
  }, '火化完成');
  const d4: any = await api('GET', `/api/appointments/${id}`, {});
  log(`火化证明已出具：${d4.certificate.cert_no}（单独火化：${d4.certificate.private_cremation}）`);

  // 14. 纪念品失败处理：爪印失败 → 客服拟重做方案（材料占用+不可逆风险）→ 主人确认 → 重做 → 主管复核 → 家属评价
  await login('art1');
  const paw = d4.mementos.find((m: any) => m.kind === 'pawprint');
  await api('POST', `/api/mementos/${paw.id}/start`, {});
  await api('POST', `/api/mementos/${paw.id}/fail`, {
    reason: '脱模时泥坯开裂',
    remaining_materials: '余泥 1 份（用后无备用），宠物爪印为唯一不可复现印记',
    owner_choice: '深棕泥 + 名字「布丁」刻字',
    remaining_attempts: 1,
  }, '爪印失败立案');
  log('纪念品失败已立案：关联制作人/剩余材料/主人选择，并生成即时关怀回访');

  // 毛发纪念瓶也失败：演示「退款」方案（费用冲减同步财务）
  const hair = d4.mementos.find((m: any) => m.kind === 'hair');
  await api('POST', `/api/mementos/${hair.id}/start`, {});
  await api('POST', `/api/mementos/${hair.id}/fail`, {
    reason: '封存瓶注胶时产生气泡，毛发封存位置偏移',
    remaining_materials: '毛发余量 0.3g，仅够 1 次',
    owner_choice: '银色吊坠瓶',
    remaining_attempts: 1,
  }, '毛发瓶失败立案');

  await login('cs1');
  let d4b: any = await api('GET', `/api/appointments/${id}`, {});
  const pawCase = d4b.failure_cases.find((c: any) => c.kind === 'pawprint' && c.status === 'open');
  const hairCase = d4b.failure_cases.find((c: any) => c.kind === 'hair' && c.status === 'open');
  const due3 = new Date(Date.now() + 3 * 86400000).toISOString();

  // 爪印 → 重做（不额外收费；明确材料占用与不可逆风险；新承诺交付排期）
  await api('POST', `/api/memento-failures/${pawCase.id}/propose`, {
    resolution: 'remake', fee_adjustment: 0, promised_at: due3,
    material_consume: '占用仅剩爪印泥 1 份',
    irreversible_risk: '剩余爪印泥为唯一纪念材料，再次失败将无法重做，爪印永久缺失',
    note: '由原制作人阿岚亲手重做，加强阴干时间',
  }, '客服拟重做方案');

  // 毛发瓶 → 退款冲减 90 元（主人确认后同步财务、计入最终费用）
  await api('POST', `/api/memento-failures/${hairCase.id}/propose`, {
    resolution: 'refund', fee_adjustment: -90, fee_title: '毛发纪念瓶制作失败退款',
    note: '家属选择不再重做，退回该纪念品费用',
  }, '客服拟退款方案');

  // 主人逐条确认方案（费用调整与制作排期在确认后同步）
  await login('owner1');
  d4b = await api('GET', `/api/appointments/${id}`, {});
  const caseConfirms = d4b.confirmations
    .filter((c: any) => c.subject === 'memento_failure' && c.status === 'pending')
    .sort((x: any, y: any) => x.id - y.id);
  for (const cc of caseConfirms) {
    await api('POST', `/api/appointments/${id}/confirmations/${cc.id}/respond`,
      { approve: true, note: '明白不可逆风险，同意处理' }, '主人确认失败方案');
  }
  log('主人已确认：爪印重做（占用剩余材料+排期 3 日）、毛发瓶退款 -90 元（已同步财务）');

  // 14b. 重做件完成 → 制作主管复核通过 → 家属评价结案
  await login('art1');
  d4b = await api('GET', `/api/appointments/${id}`, {});
  const pawNow = d4b.mementos.find((m: any) => m.id === paw.id);
  await api('POST', `/api/mementos/${pawNow.id}/done`,
    { media: ['https://example.com/photos/paw-remake-ok.jpg'] }, '重做完成送复核');

  await login('artm1');
  d4b = await api('GET', `/api/appointments/${id}`, {});
  const reviewing = d4b.failure_cases.find((c: any) => c.status === 'reviewing');
  await api('POST', `/api/memento-failures/${reviewing.id}/review`,
    { approve: true, note: '泥面完整、刻字清晰，同意交付' }, '制作主管复核');

  await login('owner1');
  d4b = await api('GET', `/api/appointments/${id}`, {});
  const reviewed = d4b.failure_cases.find((c: any) => c.status === 'reviewed' && c.resolution === 'remake');
  await api('POST', `/api/memento-failures/${reviewed.id}/rate`,
    { rating: 5, note: '重做很用心，风险也提前讲清楚了，感谢' }, '家属评价');

  // 退款方案免制作复核，主人直接评价结案
  const refundReviewed = d4b.failure_cases.find((c: any) => c.status === 'reviewed' && c.resolution === 'refund');
  await api('POST', `/api/memento-failures/${refundReviewed.id}/rate`,
    { rating: 4, note: '虽有遗憾，退款处理及时' }, '家属评价退款案');

  // 相册纪念品正常完成
  await login('art1');
  d4b = await api('GET', `/api/appointments/${id}`, {});
  for (const m of d4b.mementos.filter((x: any) => x.status === 'pending')) {
    await api('POST', `/api/mementos/${m.id}/start`, {});
    await api('POST', `/api/mementos/${m.id}/done`, { media: [] });
  }
  log('失败处理全部闭环：重做案与退款案均经主管/评价环节结案');

  // 15. 客服完成纪念品失败关怀回访
  await login('cs1');
  const care = (await api('GET', '/api/followups?status=scheduled', {}) as any[])
    .find(f => f.trigger === 'memento_failed');
  await api('POST', `/api/followups/${care.id}/complete`, {
    emotion_note: '起初难过，得知重做并加急、退款也及时，情绪平复',
    content: '已致歉并说明重做的不可逆风险与排期，赠送一张周年纪念照',
  });

  // 16. 骨灰盒寄送 → 破损 → 补发 → 签收
  const ship: any = await api('POST', `/api/appointments/${id}/shipment`,
    { carrier: '顺丰速运', tracking_no: 'SF10001' }, '寄出骨灰盒');
  await api('POST', `/api/shipments/${ship.id}/damage`, {
    note: '外盒挤压变形，木盒边角磕裂',
    media: ['https://example.com/photos/damage-01.jpg'],
  }, '寄送破损');
  await api('POST', `/api/shipments/${ship.id}/resend`,
    { carrier: '顺丰速运', tracking_no: 'SF10002' }, '破损补发');
  await api('POST', `/api/shipments/${ship.id}/delivered`, {});
  await api('POST', `/api/shipments/${ship.id}/claim`, {});

  // 17. 财务收款（按最终金额一次收清）
  await login('fin1');
  const d5: any = await api('GET', `/api/appointments/${id}`, {});
  const payable = d5.fee_summary.payable;
  await api('POST', `/api/appointments/${id}/payment`,
    { amount: payable, method: 'wechat', note: '方案+体重补差，已结清' }, '财务收款');
  log(`财务收款 ${payable} 元（报价 ${d5.fee_summary.quote_total} + 确认变更 ${d5.fee_summary.confirmed_change}）`);

  // 18. 客服完结归档
  await login('cs1');
  await api('POST', `/api/appointments/${id}/complete`, { note: '家属致谢' }, '完结');

  // 19. 管理者总览 & 柜位演示（第二单走寄存，演示到期扫描）
  await login('manager1');
  const ov: any = await api('GET', '/api/manager/overview', {});
  log(`管理者总览：总单 ${ov.total}，未闭环异常 ${ov.open_exceptions}，应收 ${ov.payable_total}，已收 ${ov.paid_total}`);

  // 20. 第二只宠物快速走通入柜，再手动验证柜位扫描
  await login('owner2');
  const a2: any = await api('POST', '/api/appointments', {
    store_id: 2, pet_name: '雪球', pet_type: 'rabbit', pet_breed: '垂耳兔',
    weight_kg: 1.8, death_time: new Date().toISOString(),
    need_pickup: true, pickup_address: '本市湖畔家园',
    want_urn: false, pawprint_hair: true, storage_months: 12,
  });
  await login('cs2');
  await api('POST', `/api/appointments/${a2.id}/confirm-plan`, {});
  const dd: any = await api('GET', `/api/appointments/${a2.id}`, {});
  const pc = dd.confirmations.find((c: any) => c.subject === 'plan');
  await login('owner2');
  await api('POST', `/api/appointments/${a2.id}/confirmations/${pc.id}/respond`, { approve: true });
  await login('cs2');
  await api('POST', `/api/appointments/${a2.id}/dispatch`, {
    driver_id: 6, ceremonialist_id: 8, cremator_id: 10,
    pickup_at: h(1), ceremony_at: h(2), furnace_at: h(3),
    furnace_name: '2号火化炉',
  });
  await login('driver2');
  await api('POST', `/api/appointments/${a2.id}/pickup`, { actual_weight_kg: 1.8, media: [] });
  await api('POST', `/api/appointments/${a2.id}/cold-in`, { media: [] });
  await login('fire2');
  await api('POST', `/api/appointments/${a2.id}/cremation-start`, {});
  await api('POST', `/api/appointments/${a2.id}/cremation-complete`, { media: [] }, '雪球火化');

  // 雪球：爪印泥失败 → 客服拟「替代纪念品」方案（退差价 -30，新排期）→ 主人确认
  //       → 制作 → 主管首次退回 → 重做 → 主管复核通过 → 家属评价
  await login('art2');
  let d6: any = await api('GET', `/api/appointments/${a2.id}`, {});
  const paw2 = d6.mementos.find((m: any) => m.kind === 'pawprint');
  await api('POST', `/api/mementos/${paw2.id}/start`, {});
  await api('POST', `/api/mementos/${paw2.id}/fail`, {
    reason: '兔爪较小，泥坯受力碎裂，无法保留完整掌纹',
    remaining_materials: '余泥 1 份但兔掌纹无法二次取印',
    owner_choice: '标准爪印牌',
    remaining_attempts: 0,
  }, '雪球爪印失败（材料不可再制）');

  await login('cs2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  const altCase0 = d6.failure_cases.find((c: any) => c.status === 'open');
  await api('POST', `/api/memento-failures/${altCase0.id}/propose`, {
    resolution: 'alternative', fee_adjustment: -30,
    fee_title: '爪印牌改水晶毛发吊坠差价退还',
    alternative_name: '水晶毛发吊坠', promised_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    note: '兔掌纹无法二次取印，改用留存毛发制作水晶吊坠，退差价 30 元',
  }, '客服拟替代方案');

  await login('owner2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  const altConfirm = d6.confirmations.find((c: any) => c.subject === 'memento_failure' && c.status === 'pending');
  await api('POST', `/api/appointments/${a2.id}/confirmations/${altConfirm.id}/respond`,
    { approve: true, note: '同意改做水晶吊坠' }, '主人确认替代方案');

  await login('art2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  const altMemento = d6.mementos.find((m: any) => m.id === d6.failure_cases[0].replacement_memento_id);
  await api('POST', `/api/mementos/${altMemento.id}/start`, {});
  await api('POST', `/api/mementos/${altMemento.id}/done`, { media: [] }, '替代件首件送复核');

  // 主管第一次复核：退回重做
  await login('artm2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  let rv = d6.failure_cases.find((c: any) => c.status === 'reviewing');
  await api('POST', `/api/memento-failures/${rv.id}/review`,
    { approve: false, note: '吊坠内毛发排布不均，退回重做' }, '主管退回重做');

  // 制作人重做后再次送复核，主管通过
  await login('art2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  const altAgain = d6.mementos.find((m: any) => m.id === d6.failure_cases[0].replacement_memento_id);
  await api('POST', `/api/mementos/${altAgain.id}/done`, { media: [] }, '替代件重做送复核');
  await login('artm2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  rv = d6.failure_cases.find((c: any) => c.status === 'reviewing');
  await api('POST', `/api/memento-failures/${rv.id}/review`,
    { approve: true, note: '排布均匀、封存完好，通过' }, '主管复核通过');

  await login('owner2');
  d6 = await api('GET', `/api/appointments/${a2.id}`, {});
  const altReviewed = d6.failure_cases.find((c: any) => c.status === 'reviewed');
  await api('POST', `/api/memento-failures/${altReviewed.id}/rate`,
    { rating: 5, note: '水晶吊坠很漂亮，退回重做体现了负责' }, '家属评价替代案');
  log('雪球替代纪念品案闭环：含主管退回→重做→复核通过→家属评价，差价 -30 已同步财务');

  await login('cs2');
  const lk = await api('POST', `/api/appointments/${a2.id}/locker-assign`,
    { code: 'B-01-01' }, '入柜寄存');
  log(`雪球骨灰入柜 ${lk.code}，到期 ${new Date(lk.expire_at).toLocaleDateString('zh-CN')}`);
  const scan: any = await api('POST', '/api/lockers/scan', {});
  log(`柜位扫描：${scan.scanned} 个占用柜位，临期 ${scan.expiring}，过期 ${scan.expired}`);

  await login('owner1');
  const final: any = await api('GET', `/api/appointments/${id}`, {});
  log(`\n布丁单最终状态：${final.appointment.status}，时间线 ${final.timeline.length} 个可追溯节点，待回访 ${final.followups.filter((f:any)=>f.status==='scheduled').length} 项`);
  log('演示完成 ✅');
}

main().catch(e => { console.error('\n❌ 演示失败:', e.message); process.exit(1); });
