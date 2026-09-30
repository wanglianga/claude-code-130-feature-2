/**
 * 端到端业务演示（直接走 HTTP API）。
 * 前置：MariaDB 已启动、已 npm run seed、后端已在 4000 端口运行。
 * 运行：npm run demo
 *
 * 覆盖：主人下单（含转介/全部服务选项）→ 客服方案+家属确认 → 调度
 * → 交通延误 → 接运（体重不符自动补差）→ 冷藏 → 家属改期 → 视频见证
 * → 告别 → 火化证明 → 纪念品失败/重做 → 骨灰盒寄送破损/补发 → 柜位入存
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

/** 断言某个请求必须失败（用于校验权限/业务拦截） */
async function expectFail(method: string, path: string, body: any, who: string, keyword?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) throw new Error(`${who} → 预期失败但成功了`);
  const msg = await res.text();
  if (keyword && !msg.includes(keyword)) {
    throw new Error(`${who} → 预期错误含「${keyword}」，实际：${msg.slice(0, 200)}`);
  }
  log(`  拦截校验 OK：${who} → ${res.status} ${keyword || ''}`);
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

  // 13.5 家属先预付当前应收（方案报价 + 体重补差），后续纪念品失败处理再做退款/补收
  await login('fin1');
  const prepaid = d4.fee_summary.payable;
  await api('POST', `/api/appointments/${id}/payment`,
    { amount: prepaid, method: 'wechat', note: '服务交付阶段预付款（纪念品交付前结算）' }, '财务登记预付');
  log(`家属预付款 ${prepaid} 元（报价 + 体重补差），失败处理费用后续多退少补`);

  // 14. 纪念品失败处理：爪印泥（重做耗材料）/ 毛发瓶（主人拒绝替代→退款）/ 相册（替代纪念品）
  await login('art1');
  const paw = d4.mementos.find((m: any) => m.kind === 'pawprint');
  const hair = d4.mementos.find((m: any) => m.kind === 'hair');
  const album = d4.mementos.find((m: any) => m.kind === 'photo_album');

  const RISK = '爪印泥/毛发为不可再生材料，二次制作仍有失败可能；再次损耗后将无法重做。';

  // —— 爪印泥：失败（2 份→1）→ 客服提案重做 → 主管复核 → 主人确认（1 份→0，排期+3 日）→ 重做完成
  await api('POST', `/api/mementos/${paw.id}/start`, {});
  await api('POST', `/api/mementos/${paw.id}/fail`,
    { reason: '脱模时泥坯开裂' }, '爪印泥失败');
  await login('cs1');
  await api('POST', `/api/mementos/${paw.id}/propose-case`, {
    option: 'remake', fee_delta: 0, risk_notice: RISK,
    option_note: '安排资深制作人加急重做',
  }, '客服提案重做');
  await login('sup1');
  let cases: any[] = (await api('GET', `/api/appointments/${id}`, {})).memento_cases;
  await api('POST', `/api/memento-cases/${cases[0].id}/review`,
    { approve: true, note: '尚余 1 份爪印泥，同意重做' }, '主管复核通过');
  // 拦截：客服不能替主人确认失败处理方案
  await login('cs1');
  let ownerConf: any = (await api('GET', `/api/appointments/${id}`, {})).confirmations
    .find((c: any) => c.subject === 'memento_case' && c.status === 'pending');
  await expectFail('POST', `/api/appointments/${id}/confirmations/${ownerConf.id}/respond`,
    { approve: true }, '客服替主人确认失败方案', '主人本人确认');
  await login('owner1');
  let conf: any = (await api('GET', `/api/appointments/${id}`, {})).confirmations
    .find((c: any) => c.subject === 'memento_case' && c.status === 'pending');
  await api('POST', `/api/appointments/${id}/confirmations/${conf.id}/respond`,
    { approve: true, note: '理解风险，同意重做，请一定保住布丁的爪印' }, '主人确认重做');
  await login('art1');
  await api('POST', `/api/mementos/${paw.id}/done`,
    { media: ['https://example.com/photos/paw-ok.jpg'] }, '重做完成');
  await login('owner1');
  cases = (await api('GET', `/api/appointments/${id}`, {})).memento_cases;
  await api('POST', `/api/memento-cases/${cases.find((c: any) => c.option === 'remake').id}/rate`,
    { rating: 5, note: '重做的爪印很清晰，谢谢' }, '主人评价重做');

  // —— 毛发纪念瓶：失败（1 份→0）→ 客服先提替代被主人拒绝 → 重新提案退款 → 主管复核 → 主人确认 → 财务退款 → 评价
  await login('art1');
  await api('POST', `/api/mementos/${hair.id}/start`, {});
  await api('POST', `/api/mementos/${hair.id}/fail`,
    { reason: '封存时发现毛发余量不足以灌注整瓶' }, '毛发瓶失败');
  await login('cs1');
  await api('POST', `/api/mementos/${hair.id}/propose-case`, {
    option: 'alternative', fee_delta: 60, alternative_name: '水晶胎毛吊坠',
    risk_notice: RISK, option_note: '余量仅够做小型吊坠',
  }, '客服提案替代');
  await login('sup1');
  let detail: any = await api('GET', `/api/appointments/${id}`, {});
  let hc = detail.memento_cases.find((c: any) => c.option === 'alternative');
  await api('POST', `/api/memento-cases/${hc.id}/review`, { approve: true, note: '同意' });
  await login('owner1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  conf = detail.confirmations.find((c: any) => c.subject === 'memento_case' && c.status === 'pending');
  await api('POST', `/api/appointments/${id}/confirmations/${conf.id}/respond`,
    { approve: false, note: '我们只想要原来的毛发纪念瓶' }, '主人拒绝替代');
  await login('cs1');
  await api('POST', `/api/mementos/${hair.id}/propose-case`, {
    option: 'refund', fee_delta: -180, risk_notice: RISK,
    option_note: '尊重家属意愿，全额退还毛发纪念瓶费用',
  }, '客服重新提案退款');
  await login('sup1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  hc = detail.memento_cases.find((c: any) => c.option === 'refund');
  await api('POST', `/api/memento-cases/${hc.id}/review`,
    { approve: true, note: '材料确已不足，同意退款' }, '主管复核退款');
  await login('owner1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  conf = detail.confirmations.find((c: any) => c.subject === 'memento_case' && c.status === 'pending');
  await api('POST', `/api/appointments/${id}/confirmations/${conf.id}/respond`,
    { approve: true, note: '同意退款' }, '主人确认退款');
  await login('fin1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  hc = detail.memento_cases.find((c: any) => c.option === 'refund');
  await api('POST', `/api/appointments/${id}/refund`,
    { amount: 180, reason: '毛发纪念瓶制作失败，主人确认退款方案', case_id: hc.id }, '财务退款');
  await login('owner1');
  await api('POST', `/api/memento-cases/${hc.id}/rate`,
    { rating: 4, note: '虽然遗憾，但退款和沟通都很及时' }, '主人评价退款');

  // —— 相册：失败 → 替代纪念品（琉璃画像挂饰，差价 +50）→ 主管复核 → 主人确认 → 新制作单排入档期 → 财务确认补收 → 评价
  await login('art1');
  await api('POST', `/api/mementos/${album.id}/start`, {});
  await api('POST', `/api/mementos/${album.id}/fail`,
    { reason: '素材冲印校色失败' }, '相册失败');
  await login('cs1');
  await api('POST', `/api/mementos/${album.id}/propose-case`, {
    option: 'alternative', fee_delta: 50, alternative_name: '琉璃画像挂饰',
    risk_notice: '替代纪念品使用电子照片制作，不再消耗原生物材料。',
  }, '客服提案替代挂饰');
  await login('sup1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  const ac = detail.memento_cases.find((c: any) => c.option === 'alternative' && c.alternative_name.includes('琉璃'));
  await api('POST', `/api/memento-cases/${ac.id}/review`, { approve: true, note: '同意替代方案' });
  await login('owner1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  conf = detail.confirmations.find((c: any) => c.subject === 'memento_case' && c.status === 'pending');
  await api('POST', `/api/appointments/${id}/confirmations/${conf.id}/respond`,
    { approve: true, note: '挂饰也很好，同意' }, '主人确认替代');
  const altMemento: any = (await api('GET', `/api/appointments/${id}`, {})).mementos
    .find((m: any) => m.name.includes('琉璃画像挂饰'));
  log(`替代纪念品已排入制作档期：#${altMemento.id} ${altMemento.name}，承诺 ${new Date(altMemento.due_at).toLocaleString('zh-CN')}`);
  await login('art1');
  await api('POST', `/api/mementos/${altMemento.id}/start`, {});
  await api('POST', `/api/mementos/${altMemento.id}/done`, { media: [] }, '替代纪念品完成');
  await login('fin1');
  detail = await api('GET', `/api/appointments/${id}`, {});
  await api('POST', `/api/memento-cases/${ac.id}/finance-confirm`,
    { note: '替代纪念品差价 50 元已并入应收' }, '财务确认补收');
  await login('owner1');
  await api('POST', `/api/memento-cases/${ac.id}/rate`,
    { rating: 5, note: '挂饰很精致' }, '主人评价替代');
  log('三类失败处理全部闭环：重做（占用剩余材料）/ 退款（财务执行）/ 替代纪念品（新排期+补收）');

  // 15. 客服完成纪念品失败关怀回访
  await login('cs1');
  const care = (await api('GET', '/api/followups?status=scheduled', {}) as any[])
    .find(f => f.trigger === 'memento_failed');
  await api('POST', `/api/followups/${care.id}/complete`, {
    emotion_note: '起初难过，得知重做并加急后情绪平复',
    content: '已致歉并说明重做/退款/替代方案与不可逆风险，家属确认处理方式',
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

  // 17. 财务收尾：预付款后经历退款 180 / 替代补收 50，按未结清余额多退少补
  await login('fin1');
  const d5: any = await api('GET', `/api/appointments/${id}`, {});
  const balance = Number(d5.fee_summary.balance.toFixed(2));
  if (balance > 0) {
    await api('POST', `/api/appointments/${id}/payment`,
      { amount: balance, method: 'wechat', note: '替代纪念品差价补收尾款' }, '财务收尾补收');
  } else if (balance < 0) {
    await api('POST', `/api/appointments/${id}/refund`,
      { amount: -balance, reason: '失败处理后尾款退回' }, '财务尾款退回');
  }
  log(`财务收尾：报价 ${d5.fee_summary.quote_total} + 变更 ${d5.fee_summary.confirmed_change}，已收 ${d5.fee_summary.paid} / 退 ${d5.fee_summary.refunded}，结清余额 0`);

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
    want_urn: false, storage_months: 12,
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
