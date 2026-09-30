'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../AppShell';
import {
  api, CASE_OPTION_LABEL, CASE_STATUS_LABEL, caseStatusTag, fmt, getSession,
  PET_LABEL, ROLE_LABEL, STATUS_LABEL, statusTag, yuan,
} from '../../lib';

function useDetail(id: number) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    setErr('');
    try { setD(await api('GET', `/api/appointments/${id}`)); }
    catch (e: any) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn: () => Promise<any>, okText?: string) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(okText || '操作成功'); await load(); }
    catch (e: any) { setErr(e.message); }
  };
  return { d, setD, err, setErr, msg, setMsg, load, act };
}

const inp = { width: 150 };

export default function DetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [s, setS] = useState<any>(null);
  useEffect(() => setS(getSession()), []);
  const { d, err, msg, load, act } = useDetail(Number(id));
  const [staff, setStaff] = useState<any>({});
  const [resources, setResources] = useState<any>(null);

  const role = s?.user?.role;

  useEffect(() => {
    if (!d || !s) return;
    if (['customer_service', 'manager'].includes(role)) {
      Promise.all([
        api('GET', '/api/staff'),
        api('GET', `/api/resources?store_id=${d.appointment.store_id}`),
      ]).then(([st, rs]) => {
        const by: any = {};
        st.forEach((u: any) => { (by[u.role] ||= []).push(u); });
        setStaff(by); setResources(rs);
      }).catch(() => {});
    }
  }, [d, s, role]);

  if (!s || !d) return <AppShell><div className="panel">{err ? <div className="error">{err}</div> : '加载中…'}</div></AppShell>;
  const a = d.appointment;
  const canCs = ['customer_service', 'manager'].includes(role);
  const pendingConfirms = d.confirmations.filter((c: any) => c.status === 'pending');
  const planConfirmed = d.confirmations.some((c: any) => c.subject === 'plan' && c.status === 'confirmed');

  return (
    <AppShell>
      <div className="section-title">
        <Link href="/appointments" className="muted">← 返回列表</Link>
      </div>
      <div className="panel">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>
              {a.pet_name} <span className="muted mono" style={{ fontSize: 13 }}>{a.code}</span>
            </h1>
            <span className={`tag ${statusTag(a.status)}`}>{STATUS_LABEL[a.status]}</span>{' '}
            <span className="tag info">{PET_LABEL[a.pet_type]} · {a.pet_breed} · 登记 {a.weight_kg}kg{a.actual_weight_kg ? ` / 复称 ${a.actual_weight_kg}kg` : ''}</span>
            {a.video_witness && <span className="tag warn">📹 视频见证</span>}
            {d.open_exceptions > 0 && <span className="tag bad">未闭环异常 {d.open_exceptions}</span>}
          </div>
          <div style={{ flex: 1 }} />
          <div className="muted">
            家属：{d.owner?.name} {d.owner?.phone}<br />
            门店：#{a.store_id} · 离世 {fmt(a.death_time)}
          </div>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {msg && <div className="ok-msg">{msg}</div>}

      <div className="grid2">
        <div>
          {/* 家属确认区 */}
          {pendingConfirms.length > 0 && (
            <div className="panel">
              <h2>待家属确认（{pendingConfirms.length}）</h2>
              {pendingConfirms.map((c: any) => (
                <PendingConfirm key={c.id} c={c} id={a.id} isOwner={role === 'owner'}
                  canCs={canCs} onDone={() => load()} />
              ))}
            </div>
          )}

          {/* 角色动作区 */}
          <RoleActions role={role} a={a} d={d} staff={staff} resources={resources}
            planConfirmed={planConfirmed} act={act} reload={load} />

          {/* 费用 */}
          <div className="panel">
            <h2>费用明细与变化</h2>
            <div className="grid3">
              <div className="stat"><div className="n">{yuan(d.fee_summary.quote_total)}</div><div className="l">方案报价</div></div>
              <div className="stat"><div className="n">{yuan(d.fee_summary.confirmed_change)}</div><div className="l">已确认变更</div></div>
              <div className="stat"><div className="n" style={{ color: d.fee_summary.balance > 0.01 ? 'var(--bad)' : 'var(--ok)' }}>
                {yuan(d.fee_summary.balance)}</div><div className="l">未结清余额（已收 {yuan(d.fee_summary.paid)}）</div></div>
            </div>
            {d.fee_summary.pending_change !== 0 && (
              <p className="tag warn" style={{ marginTop: 8 }}>有待家属确认的变更 {yuan(d.fee_summary.pending_change)}</p>
            )}
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>项目</th><th>金额</th><th>类型</th><th>确认</th></tr></thead>
              <tbody>
                {d.fees.map((f: any) => (
                  <tr key={f.id}>
                    <td>{f.title}{f.reason && <div className="muted">{f.reason}</div>}</td>
                    <td className="mono">{Number(f.amount) >= 0 ? '' : ''}{yuan(f.amount)}</td>
                    <td>{f.entry_type === 'base' ? '基础项' : <span className="tag warn">变更项</span>}</td>
                    <td>{f.confirm_status === 'confirmed' ? <span className="tag ok">已确认</span>
                      : f.confirm_status === 'rejected' ? <span className="tag bad">已拒绝</span>
                      : <span className="tag warn">待确认</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <FinanceActions role={role} a={a} d={d} act={act} />
          </div>

          {/* 排期与承诺时间 */}
          <div className="panel">
            <h2>承诺时间与资源排期</h2>
            <dl className="kv">
              <dt>承诺接运</dt><dd>{fmt(a.pickup_promised_at)} {a.pickup_actual_at && <span className="tag ok">实际 {fmt(a.pickup_actual_at)}</span>}</dd>
              <dt>告别仪式</dt><dd>{fmt(a.ceremony_scheduled_at)} {a.ceremony_started_at && <span className="tag ok">已于 {fmt(a.ceremony_started_at)} 开始</span>}</dd>
              <dt>火化炉</dt><dd>{fmt(a.furnace_scheduled_at)} {a.cremated_at && <span className="tag ok">完成 {fmt(a.cremated_at)}</span>}</dd>
              <dt>接送员</dt><dd>{d._staff?.driver || (a.driver_id ? `#${a.driver_id}` : '—')}</dd>
              <dt>礼仪师</dt><dd>{a.ceremonialist_id ? `#${a.ceremonialist_id}` : '—'}</dd>
              <dt>火化师</dt><dd>{a.cremator_id ? `#${a.cremator_id}` : '—'}</dd>
            </dl>
            {d.furnaces.length > 0 && <p className="muted">火化炉档期：{d.furnaces.map((x: any) => `${x.furnace_name} ${fmt(x.start_at)} [${x.status}]`).join('；')}</p>}
            {d.rooms.length > 0 && <p className="muted">告别室档期：{d.rooms.map((x: any) => `${x.room_name} ${fmt(x.start_at)} [${x.status}]`).join('；')}</p>}
            {d.cold_storage.length > 0 && <p className="muted">冷藏暂存：{d.cold_storage.map((x: any) => `${x.cell_name} ${x.in_at ? '入位 ' + fmt(x.in_at) : '已预留'}${x.out_at ? ' → ' + fmt(x.out_at) + ' 出位' : ''}`).join('；')}</p>}
          </div>

          {/* 火化证明 */}
          {d.certificate && (
            <div className="panel">
              <h2>火化证明</h2>
              <dl className="kv">
                <dt>证明编号</dt><dd className="mono">{d.certificate.cert_no}</dd>
                <dt>火化时间</dt><dd>{fmt(d.certificate.cremated_at)}</dd>
                <dt>火化方式</dt><dd>{d.certificate.private_cremation ? '单独火化' : '集中火化'}</dd>
              </dl>
              {d.certificate.media_urls?.length > 0 && (
                <div className="media-list">炉前/炉后见证：{d.certificate.media_urls.map((u: string) => <span key={u}>📷 {u.split('/').pop()}</span>)}</div>
              )}
            </div>
          )}
        </div>

        <div>
          {/* 纪念品 */}
          <div className="panel">
            <h2>纪念品制作（{d.mementos.length}）</h2>
            {d.mementos.length === 0 ? <p className="muted">本单无纪念品</p> : (
              <table>
                <thead><tr><th>项目</th><th>状态</th><th>剩余材料</th><th>承诺交付</th>{(role === 'artisan' || canCs) && <th>操作</th>}</tr></thead>
                <tbody>
                  {d.mementos.map((m: any) => (
                    <tr key={m.id}>
                      <td>{m.name}
                        {m.remake_count > 0 && <span className="tag warn">已重做 {m.remake_count} 次</span>}
                        {m.fail_reason && <div className="muted" style={{ color: 'var(--bad)' }}>失败原因：{m.fail_reason}</div>}
                      </td>
                      <td><MementoTag s={m.status} /></td>
                      <td>{m.material_name} <b>{m.material_remaining}</b> 份</td>
                      <td>{fmt(m.due_at)}</td>
                      {(role === 'artisan' || canCs) && (
                        <td className="pill-actions">
                          {m.status === 'pending' && <button className="small" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/start`, {}), '已开始制作')}>开始</button>}
                          {m.status === 'making' && <>
                            <button className="small danger" onClick={() => {
                              const reason = prompt('失败原因？') || '工艺原因';
                              act(() => api('POST', `/api/mementos/${m.id}/fail`, { reason }),
                                '已登记失败（消耗 1 份材料），已生成家属关怀回访，待客服提出处理方案');
                            }}>登记失败</button>
                            <button className="small ok" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/done`, { media: [] }), '已完成')}>完成</button>
                          </>}
                          {m.status === 'remake' && <button className="small ok" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/done`, { media: [] }), '重做完成')}>重做完成</button>}
                          {m.status === 'failed' && canCs && (() => {
                            const c = (d.memento_cases || []).filter((x: any) => x.memento_id === m.id).pop();
                            const needNew = !c || ['review_rejected', 'owner_rejected'].includes(c.status);
                            return needNew ? (
                              <button className="small" onClick={() => {
                                document.getElementById(`case-form-${m.id}`)
                                  ?.scrollIntoView({ behavior: 'smooth' });
                              }}>{c ? '重新提出处理方案' : '提出处理方案'}</button>
                            ) : (
                              <span className="tag info">处理方案{CASE_STATUS_LABEL[c.status]}</span>
                            );
                          })()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 6 }}>
              爪印泥 / 毛发纪念瓶失败会消耗材料；处理流程：客服提案（重做/退款/替代+不可逆风险）→ 制作主管复核 → 主人确认 → 费用与排期同步 → 财务入账 → 家属评价。
            </p>
            <MementoCaseList d={d} role={role} canCs={canCs} act={act} reload={load} />
          </div>

          {/* 骨灰盒寄送 */}
          <div className="panel">
            <h2>骨灰盒寄送</h2>
            {d.shipments.length === 0 ? <p className="muted">暂无寄送记录{a.want_urn && canCs ? '' : ''}</p> : (
              d.shipments.map((s2: any) => (
                <div key={s2.id} style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 8, marginBottom: 8 }}>
                  {s2.carrier} <span className="mono">{s2.tracking_no}</span>{' '}
                  <ShipmentTag s={s2.status} />
                  <div className="muted">寄出 {fmt(s2.ship_at)}{s2.delivered_at ? ` · 签收 ${fmt(s2.delivered_at)}` : ''}</div>
                  {s2.damage_note && <div style={{ color: 'var(--bad)' }}>破损记录：{s2.damage_note}</div>}
                  {s2.resend_tracking_no && <div className="muted">补发单号：{s2.resend_tracking_no}</div>}
                  <div className="pill-actions" style={{ marginTop: 4 }}>
                    {(role === 'owner' || canCs) && s2.status === 'in_transit' &&
                      <button className="small danger" onClick={() => {
                        const note = prompt('破损情况描述？') || '家属反馈外盒破损';
                        act(() => api('POST', `/api/shipments/${s2.id}/damage`, { note, media: [] }), '已登记破损，将安排补发与关怀');
                      }}>家属反馈破损</button>}
                    {canCs && s2.status === 'damaged' &&
                      <button className="small" onClick={() => {
                        const no = prompt('补发快递单号？', 'SF' + Math.floor(Math.random() * 90000 + 10000)) || '';
                        act(() => api('POST', `/api/shipments/${s2.id}/resend`, { carrier: s2.carrier, tracking_no: no }), '已补发');
                      }}>安排补发</button>}
                    {canCs && ['in_transit', 'resent'].includes(s2.status) &&
                      <button className="small ghost" onClick={() => act(() => api('POST', `/api/shipments/${s2.id}/delivered`, {}), '已签收')}>登记送达</button>}
                    {(role === 'owner' || canCs) && s2.status === 'delivered' &&
                      <button className="small ok" onClick={() => act(() => api('POST', `/api/shipments/${s2.id}/claim`, {}), '家属确认完好签收')}>确认完好签收</button>}
                  </div>
                </div>
              ))
            )}
            {canCs && a.want_urn && !d.locker && (
              <button className="small" onClick={() => {
                const no = prompt('快递单号？', 'SF' + Math.floor(Math.random() * 90000 + 10000)) || '';
                if (no) act(() => api('POST', `/api/appointments/${a.id}/shipment`, { carrier: '顺丰速运', tracking_no: no }), '已寄出');
              }}>＋ 登记骨灰盒寄送</button>
            )}
          </div>

          {/* 柜位 */}
          <div className="panel">
            <h2>骨灰寄存柜位</h2>
            {d.locker ? (
              <>
                <dl className="kv">
                  <dt>柜位</dt><dd>{d.locker.code}（{d.locker.tier === 'premium' ? '尊享柜' : '标准柜'}）<LockerTag s={d.locker.status} /></dd>
                  <dt>入存时间</dt><dd>{fmt(d.locker.occupied_since)}</dd>
                  <dt>到期时间</dt><dd>{fmt(d.locker.expire_at)}（年费 {yuan(d.locker.annual_fee)}）</dd>
                </dl>
                {canCs && ['occupied', 'expiring', 'expired'].includes(d.locker.status) && (
                  <button className="small" onClick={() => act(() => api('POST', `/api/lockers/${d.locker.id}/renew`, { months: 12 }), '已续费 12 个月')}>续费 12 个月</button>
                )}
              </>
            ) : (
              <>
                <p className="muted">尚未入柜寄存</p>
                {canCs && a.status === 'fulfilled' && resources && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select id="lockerPick" style={{ flex: 1 }} defaultValue="">
                      <option value="" disabled>选择空闲柜位</option>
                      {resources.lockers.filter((l: any) => l.store_id === a.store_id && l.status === 'free').map((l: any) =>
                        <option key={l.id} value={l.code}>{l.code} · {l.tier === 'premium' ? '尊享柜' : '标准柜'} · {yuan(l.annual_fee)}/年</option>)}
                    </select>
                    <button className="small" onClick={() => {
                      const code = (document.getElementById('lockerPick') as HTMLSelectElement).value;
                      if (code) act(() => api('POST', `/api/appointments/${a.id}/locker-assign`, { code }), '已入柜');
                    }}>安排入柜</button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 相册 */}
          <AlbumPanel a={a} d={d} role={role} act={act} />

          {/* 留言 */}
          <MessagePanel a={a} d={d} me={s.user} reload={load} />
        </div>
      </div>

      {/* 时间线 */}
      <div className="panel">
        <h2>全程交接时间线（{d.timeline.length} 个可追溯节点）</h2>
        <div className="timeline">
          {[...d.timeline].reverse().map((t: any) => (
            <div key={t.id} className={`tl-item ${t.flag === 'exception' ? 'exc' : t.flag === 'resolved' ? 'res' : ''}`}>
              <div className="tl-title">
                {t.flag === 'exception' ? '⚠ ' : t.flag === 'resolved' ? '✓ ' : ''}{t.title}
              </div>
              <div className="tl-meta">
                {fmt(t.occurred_at)} · {t.actor_role ? `${ROLE_LABEL[t.actor_role] || t.actor_role}` : '系统'}
                {t.promised_at && ` · 承诺时间 ${fmt(t.promised_at)}`}
              </div>
              {t.note && <div>{t.note}</div>}
              {t.media_urls?.length > 0 && (
                <div className="media-list">交接材料：{t.media_urls.map((u: string) => <span key={u}>📎 {u.split('/').pop()}</span>)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function PendingConfirm({ c, id, isOwner, canCs, onDone }: any) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function respond(approve: boolean) {
    setBusy(true); setErr('');
    try { await api('POST', `/api/appointments/${id}/confirmations/${c.id}/respond`, { approve }); onDone(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  async function approveReschedule(approve: boolean) {
    setBusy(true); setErr('');
    try {
      await api('POST', `/api/appointments/${id}/reschedule/${c.id}/approve`,
        { approve, note: approve ? '已协调礼仪师与告别室' : '告别室档期冲突，请另选时间' });
      onDone();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  const subjectMap: any = { plan: '服务方案', fee_change: '费用变更', ceremony_time: '仪式时间改期', video_witness: '视频见证', memento_case: '纪念品失败处理方案' };
  const isReschedule = c.subject === 'ceremony_time';
  return (
    <div style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 10, marginBottom: 10 }}>
      <span className="tag warn">{subjectMap[c.subject] || c.subject} · 待处理</span>
      <p style={{ margin: '6px 0' }}>{String(c.content).replace(/\[(FEE|TIME|CASE)\].*?\[\/\1\]/g, '')}</p>
      {err && <div className="error">{err}</div>}
      {isReschedule ? (
        canCs ? (
          <div className="pill-actions">
            <button className="small ok" disabled={busy} onClick={() => approveReschedule(true)}>同意改期并重排告别室</button>
            <button className="small danger" disabled={busy} onClick={() => approveReschedule(false)}>驳回</button>
          </div>
        ) : <p className="muted">已提交，等待客服协调告别室与礼仪师档期</p>
      ) : isOwner ? (
        <div className="pill-actions">
          <button className="small ok" disabled={busy} onClick={() => respond(true)}>同意确认</button>
          <button className="small danger" disabled={busy} onClick={() => respond(false)}>暂不同意</button>
        </div>
      ) : <p className="muted">等待家属在主人端确认{canCs && c.subject === 'fee_change' ? '；家属拒绝后请重新协商' : ''}</p>}
    </div>
  );
}

function RoleActions({ role, a, d, staff, resources, planConfirmed, act, reload }: any) {
  const h = (n: number) => new Date(Date.now() + n * 3600e3).toISOString().slice(0, 16);
  const [pick, setPick] = useState({ at: h(2), minutes: 40, reason: '', weight: '', media: 'https://example.com/photos/handover.jpg' });
  const [fee, setFee] = useState({ title: '', amount: '', reason: '' });
  const [disp, setDisp] = useState({
    pickup_at: h(2), ceremony_at: h(20), furnace_at: h(22),
    furnace_name: '', room_name: '',
    driver_id: '', ceremonialist_id: '', cremator_id: '',
  });
  const [rs, setRs] = useState({ new_time: h(24), reason: '' });

  useEffect(() => {
    if (resources && !disp.furnace_name) {
      const used = new Set(resources.furnaces.filter((x: any) => x.status === 'locked').map((x: any) => x.furnace_name));
      setDisp(p => ({ ...p, furnace_name: ['1号火化炉', '2号火化炉'].find(n => !used.has(n)) || '1号火化炉' }));
    }
  }, [resources]);

  // 主人
  if (role === 'owner') return (
    <div className="panel">
      <h2>家属操作</h2>
      <div className="grid2">
        <div>
          <h3>更改仪式时间</h3>
          {['submitted', 'cs_confirmed', 'scheduled', 'picked_up', 'in_storage', 'farewell'].includes(a.status) ? <>
            <label>期望新时间</label><input type="datetime-local" value={rs.new_time} onChange={e => setRs({ ...rs, new_time: e.target.value })} />
            <label>原因</label><input value={rs.reason} onChange={e => setRs({ ...rs, reason: e.target.value })} placeholder="如：外地亲属想赶回参加" />
            <button className="small" onClick={() => act(() => api('POST', `/api/appointments/${a.id}/reschedule`,
              { new_time: new Date(rs.new_time).toISOString(), reason: rs.reason || '家属申请' }), '改期申请已提交，等待客服协调')}>提交改期申请</button>
          </> : <p className="muted">当前环节已不可更改仪式时间</p>}
        </div>
        <div>
          <h3>视频见证</h3>
          {a.video_witness ? <p className="tag ok">已要求视频见证，火化时将为您连线/录制</p> :
            ['submitted', 'cs_confirmed', 'scheduled', 'picked_up', 'in_storage', 'farewell'].includes(a.status) &&
            <button className="small" onClick={() => act(() => api('POST', `/api/appointments/${a.id}/video-witness`,
              { reason: '', note: '家属希望视频见证火化过程' } as any), '已登记视频见证需求')}>我要视频见证火化</button>}
        </div>
      </div>
    </div>
  );

  // 客服 / 管理者
  if (role === 'customer_service' || role === 'manager') return (
    <div className="panel">
      <h2>客服处理台</h2>
      {['submitted', 'cs_confirmed'].includes(a.status) && (
        <div style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 10 }}>
          <h3>① 确认服务方案与报价</h3>
          <p className="muted">系统已按宠物信息与选项生成建议报价；可直接核定，或填写自定义总价。</p>
          <button onClick={() => act(() => api('POST', `/api/appointments/${a.id}/confirm-plan`, {}), '方案已核定，等待家属确认')}>按建议价核定方案</button>
          <CustomQuote a={a} onDone={() => act(async () => { }, '自定义报价已核定')} />
        </div>
      )}
      {planConfirmed && ['cs_confirmed', 'scheduled'].includes(a.status) && resources && (
        <div style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 10 }}>
          <h3>② 调度排期（接送员 / 冷藏 / 火化炉 / 告别室 / 纪念品）</h3>
          <div className="grid3">
            <div><label>接运时间</label><input type="datetime-local" value={disp.pickup_at} onChange={e => setDisp({ ...disp, pickup_at: e.target.value })} /></div>
            <div><label>告别时间</label><input type="datetime-local" value={disp.ceremony_at} onChange={e => setDisp({ ...disp, ceremony_at: e.target.value })} /></div>
            <div><label>火化时间</label><input type="datetime-local" value={disp.furnace_at} onChange={e => setDisp({ ...disp, furnace_at: e.target.value })} /></div>
            <div><label>接送员</label><select onChange={e => setDisp({ ...disp, driver_id: e.target.value })} defaultValue="">
              <option value="" disabled>选择接送员</option>{(staff.driver || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
            <div><label>礼仪师</label><select onChange={e => setDisp({ ...disp, ceremonialist_id: e.target.value })} defaultValue="">
              <option value="" disabled>选择礼仪师</option>{(staff.ceremonialist || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
            <div><label>火化师</label><select onChange={e => setDisp({ ...disp, cremator_id: e.target.value })} defaultValue="">
              <option value="" disabled>选择火化师</option>{(staff.cremator || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
            <div><label>火化炉</label><select value={disp.furnace_name} onChange={e => setDisp({ ...disp, furnace_name: e.target.value })}>
              <option>1号火化炉</option><option>2号火化炉</option>
            </select></div>
            {a.want_ceremony && <div><label>告别室</label>
              <select value={disp.room_name} onChange={e => setDisp({ ...disp, room_name: e.target.value })} defaultValue="">
                <option value="" disabled>选择告别室</option>
                {[...new Set(resources.rooms.filter((x: any) => x.store_id === a.store_id).map((x: any) => x.room_name))]
                  .map((name: any) => <option key={name} value={name}>{name}</option>)}
              </select></div>}
          </div>
          <button style={{ marginTop: 8 }} onClick={() => {
            if (!disp.driver_id) return alert('请选择接送员');
            act(() => api('POST', `/api/appointments/${a.id}/dispatch`, {
              ...disp,
              pickup_at: new Date(disp.pickup_at).toISOString(),
              ceremony_at: new Date(disp.ceremony_at).toISOString(),
              furnace_at: new Date(disp.furnace_at).toISOString(),
              driver_id: Number(disp.driver_id), ceremonialist_id: Number(disp.ceremonialist_id),
              cremator_id: Number(disp.cremator_id),
              room_name: disp.room_name || (resources.rooms.find((x: any) => x.store_id === a.store_id)?.room_name),
            }), '调度完成，各岗位已收到承诺时间');
          }}>{a.status === 'scheduled' ? '重新调度（释放旧档期）' : '确认调度'}</button>
        </div>
      )}
      <div style={{ borderBottom: '1px dashed var(--line)', padding: '10px 0' }}>
        <h3>③ 登记费用变更（体重补差 / 加项 / 冲减）</h3>
        <div className="grid3">
          <input placeholder="项目名称" value={fee.title} onChange={e => setFee({ ...fee, title: e.target.value })} />
          <input placeholder="金额（负数为退减）" type="number" value={fee.amount} onChange={e => setFee({ ...fee, amount: e.target.value })} />
          <input placeholder="原因" value={fee.reason} onChange={e => setFee({ ...fee, reason: e.target.value })} />
        </div>
        <button className="small" style={{ marginTop: 6 }} onClick={() => {
          if (!fee.title || fee.amount === '') return alert('请填写项目与金额');
          act(() => api('POST', `/api/appointments/${a.id}/fee-change`,
            { kind: 'extra', title: fee.title, amount: Number(fee.amount), reason: fee.reason || '客服登记' }),
            '费用变更已登记，等待家属确认');
          setFee({ title: '', amount: '', reason: '' });
        }}>发起费用变更</button>
      </div>
      {a.status === 'fulfilled' && (
        <div style={{ paddingTop: 10 }}>
          <h3>④ 完结归档</h3>
          <p className="muted">完结前系统会校验：变更费用均确认、纪念品全部完成、费用结清、骨灰盒签收或入柜。</p>
          <button className="ok" onClick={() => act(() => api('POST', `/api/appointments/${a.id}/complete`, {}), '服务已完结，已安排 7 日后情绪安抚回访')}>校验并完结</button>
          <button className="ghost" onClick={() => { const r = prompt('取消原因？'); if (r) act(() => api('POST', `/api/appointments/${a.id}/cancel`, { reason: r }), '已取消'); }}>取消工单</button>
        </div>
      )}
    </div>
  );

  // 接送员
  if (role === 'driver') return (
    <div className="panel">
      <h2>接送员处理台</h2>
      {a.status === 'scheduled' && <>
        <div style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 10 }}>
          <h3>交通延误上报</h3>
          <div className="row">
            <div><label>延误分钟</label><input type="number" value={pick.minutes} onChange={e => setPick({ ...pick, minutes: Number(e.target.value) })} /></div>
            <div style={{ flex: 2 }}><label>原因</label><input value={pick.reason} onChange={e => setPick({ ...pick, reason: e.target.value })} placeholder="如：晚高峰事故拥堵" /></div>
          </div>
          <button className="small danger" style={{ marginTop: 6 }} onClick={() => act(() => api('POST', `/api/appointments/${a.id}/driver-delay`,
            { minutes: pick.minutes, reason: pick.reason || '交通延误' }), '延误已上报，承诺时间已顺延并通知家属')}>上报延误</button>
        </div>
        <div style={{ paddingTop: 10 }}>
          <h3>完成接运（交接照片 + 复称体重）</h3>
          <div className="row">
            <div><label>实际体重 kg</label><input type="number" step="0.1" value={pick.weight} onChange={e => setPick({ ...pick, weight: e.target.value })} /></div>
            <div style={{ flex: 2 }}><label>交接照片 URL（多个用逗号分隔）</label><input value={pick.media} onChange={e => setPick({ ...pick, media: e.target.value })} /></div>
          </div>
          <button style={{ marginTop: 6 }} onClick={() => {
            if (!pick.weight) return alert('请填写复称体重');
            act(() => api('POST', `/api/appointments/${a.id}/pickup`, {
              actual_weight_kg: Number(pick.weight),
              media: pick.media.split(',').map((x: string) => x.trim()).filter(Boolean),
            }), pick.weight !== String(a.weight_kg) ? '接运完成；体重不符已自动生成补差，待家属确认' : '接运完成');
          }}>确认接走宠物</button>
        </div>
      </>}
      {a.status === 'picked_up' && <>
        <h3>送入冷藏暂存</h3>
        <button onClick={() => act(() => api('POST', `/api/appointments/${a.id}/cold-in`,
          { media: ['https://example.com/photos/cold.jpg'], note: '冷藏温度 4℃' }), '已入冷藏暂存')}>确认入冷藏</button>
      </>}
      {!['scheduled', 'picked_up'].includes(a.status) && <p className="muted">当前无需接送员操作</p>}
    </div>
  );

  // 礼仪师
  if (role === 'ceremonialist') return (
    <div className="panel">
      <h2>礼仪师处理台</h2>
      {['in_storage', 'scheduled'].includes(a.status) &&
        <button onClick={() => act(() => api('POST', `/api/appointments/${a.id}/farewell-start`,
          { media: ['https://example.com/photos/farewell.jpg'], note: a.video_witness ? '家属视频接入正常' : '' }), '告别仪式开始')}>开始告别仪式{a.video_witness ? '（接入视频见证）' : ''}</button>}
      {a.status === 'farewell' &&
        <button className="ok" onClick={() => act(() => api('POST', `/api/appointments/${a.id}/farewell-end`,
          { media: ['https://example.com/photos/farewell-end.jpg'] }), '告别仪式结束，冷藏已释放')}>结束告别仪式</button>}
      {!['in_storage', 'scheduled', 'farewell'].includes(a.status) && <p className="muted">当前无需礼仪师操作</p>}
    </div>
  );

  // 火化师
  if (role === 'cremator') return (
    <div className="panel">
      <h2>火化师处理台</h2>
      {['farewell', 'in_storage'].includes(a.status) &&
        <button onClick={() => act(() => api('POST', `/api/appointments/${a.id}/cremation-start`,
          { note: a.private_cremation ? '单独炉火化' : '' }), '火化开始')}>开始火化{a.video_witness ? '（开启视频见证连线）' : ''}</button>}
      {a.status === 'cremating' &&
        <button className="ok" onClick={() => act(() => api('POST', `/api/appointments/${a.id}/cremation-complete`,
          { media: ['https://example.com/photos/crem-1.jpg', 'https://example.com/photos/crem-2.jpg'],
            note: a.video_witness ? '视频见证全程录制' : '' }), '火化完成，证明已出具')}>完成火化并出具证明</button>}
      {!['farewell', 'in_storage', 'cremating'].includes(a.status) && <p className="muted">当前无需火化师操作</p>}
    </div>
  );

  // 纪念品
  if (role === 'artisan') return (
    <div className="panel"><h2>纪念品工作台</h2><p className="muted">请在右侧「纪念品制作」面板对制作单执行开始 / 失败登记（消耗材料）/ 完成。失败登记后由客服提出重做、退款或替代方案，经主管复核与主人确认后，重做排期会在这里同步给你；剩余材料余量可在制作单列表查看。</p></div>
  );

  // 制作主管
  if (role === 'production_supervisor') return (
    <div className="panel"><h2>制作主管复核台</h2><p className="muted">纪念品失败处理方案（重做 / 退款 / 替代纪念品）需你复核材料余量、不可逆风险告知与费用调整后才会发送给主人。请在右侧「纪念品制作」面板复核，或前往「纪念品失败处理」队列页集中处理。</p></div>
  );

  // 财务
  if (role === 'finance') return (
    <div className="panel"><h2>财务工作台</h2><p className="muted">请在下方「费用明细与变化」面板登记收款或退款。</p></div>
  );

  return null;
}

function CustomQuote({ a, onDone }: any) {
  const [total, setTotal] = useState('');
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
      <input placeholder="自定义总价" type="number" style={inp} value={total} onChange={e => setTotal(e.target.value)} />
      <button className="ghost small" onClick={() => {
        if (!total) return alert('请填写总价');
        api('POST', `/api/appointments/${a.id}/confirm-plan`, { total: Number(total) }).then(() => onDone());
      }}>自定义报价核定</button>
    </span>
  );
}

function FinanceActions({ role, a, d, act }: any) {
  if (!['finance', 'manager'].includes(role)) return null;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('wechat');
  return (
    <div style={{ marginTop: 10 }}>
      <input placeholder="收款金额" type="number" style={{ ...inp, marginRight: 6 }} value={amount} onChange={e => setAmount(e.target.value)} />
      <select style={{ ...inp, marginRight: 6 }} value={method} onChange={e => setMethod(e.target.value)}>
        <option value="wechat">微信</option><option value="alipay">支付宝</option>
        <option value="card">刷卡</option><option value="cash">现金</option>
      </select>
      <button className="small ok" onClick={() => {
        if (!amount) return alert('请填写金额');
        act(() => api('POST', `/api/appointments/${a.id}/payment`,
          { amount: Number(amount), method }), '收款已登记'); setAmount('');
      }}>登记收款</button>
      <button className="small danger" onClick={() => {
        const v = prompt('退款金额？'); if (!v) return;
        const reason = prompt('退款原因？') || '协商退款';
        act(() => api('POST', `/api/appointments/${a.id}/refund`, { amount: Number(v), reason }), '退款已登记');
      }}>登记退款</button>
      {d.payments.length > 0 && (
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>时间</th><th>金额</th><th>方式</th><th>状态</th><th>备注</th></tr></thead>
          <tbody>{d.payments.map((p: any) => (
            <tr key={p.id}><td>{fmt(p.created_at)}</td><td className="mono">{yuan(p.amount)}</td>
              <td>{p.method}</td><td>{p.status === 'paid' ? <span className="tag ok">已收</span> : <span className="tag bad">已退</span>}</td>
              <td className="muted">{p.note}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function AlbumPanel({ a, d, role, act }: any) {
  const [f, setF] = useState({ title: '', url: '', kind: 'photo' });
  return (
    <div className="panel">
      <h2>纪念相册（{d.album.length}）</h2>
      {d.album.length === 0 && <p className="muted">暂无相册内容，交接照片会沉淀在时间线中。</p>}
      {d.album.map((m: any) => (
        <div key={m.id} style={{ padding: '5px 0', borderBottom: '1px dashed var(--line)' }}>
          {m.kind === 'photo' ? '🖼' : '🎬'} {m.title} <span className="muted">· {m.caption || m.url}</span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <input placeholder="标题" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <input placeholder="媒体 URL" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} />
        <select style={{ width: 90 }} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
          <option value="photo">照片</option><option value="video">视频</option>
        </select>
        <button className="small" style={{ width: 90 }} onClick={() => {
          if (!f.title || !f.url) return alert('请填写标题与 URL');
          act(() => api('POST', `/api/appointments/${a.id}/album`, f), '已加入相册');
          setF({ title: '', url: '', kind: 'photo' });
        }}>上传记录</button>
      </div>
    </div>
  );
}

function MessagePanel({ a, d, me, reload }: any) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel">
      <h2>围绕「{a.pet_name}」的协同留言（{d.messages.length}）</h2>
      <div className="chat">
        {d.messages.length === 0 && <p className="muted">暂无留言。主人、客服、接送员、礼仪师、火化师、纪念品与财务都在这里围绕同一只宠物沟通。</p>}
        {d.messages.map((m: any) => (
          <div key={m.id} className="msg">
            <span className="who">{m.sender_name}（{ROLE_LABEL[m.sender_role] || m.sender_role}）</span>
            <span className="muted" style={{ marginLeft: 8 }}>{fmt(m.created_at)}</span>
            <div>{m.content}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="输入留言，所有人可见…"
          onKeyDown={async e => {
            if (e.key === 'Enter' && text.trim()) {
              setBusy(true);
              await api('POST', `/api/appointments/${a.id}/messages`, { content: text.trim() });
              setText(''); setBusy(false); reload();
            }
          }} />
        <button disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          await api('POST', `/api/appointments/${a.id}/messages`, { content: text.trim() });
          setText(''); setBusy(false); reload();
        }}>发送</button>
      </div>
    </div>
  );
}

function MementoTag({ s }: { s: string }) {
  const map: any = { pending: ['待制作', 'warn'], making: ['制作中', 'info'], failed: ['制作失败', 'bad'], remake: ['重做中', 'warn'], done: ['已完成', 'ok'] };
  const [t, c] = map[s] || [s, ''];
  return <span className={`tag ${c}`}>{t}</span>;
}

const DEFAULT_RISK = '爪印泥/毛发属不可再生材料，二次制作仍可能失败；一旦再次损耗，可能无法再制作，只能选择退款或替代纪念品。';

function CaseProposeForm({ m, d, act }: { m: any; d: any; act: any }) {
  const [option, setOption] = useState('remake');
  const [fee, setFee] = useState('0');
  const [alt, setAlt] = useState('');
  const [risk, setRisk] = useState(DEFAULT_RISK);
  const [note, setNote] = useState('');
  const submit = () => {
    if (!risk.trim()) return alert('必须填写不可逆风险说明');
    const delta = Number(fee || 0);
    if (option === 'remake' && m.material_remaining <= 0) return alert('剩余材料不足，不能重做');
    if (option === 'alternative' && !alt.trim()) return alert('请填写替代纪念品名称');
    if (option === 'refund' && delta >= 0) return alert('退款方案费用调整须为负数');
    act(() => api('POST', `/api/mementos/${m.id}/propose-case`, {
      option, fee_delta: delta, alternative_name: alt, risk_notice: risk, option_note: note,
    }), '方案已提交制作主管复核');
  };
  return (
    <div id={`case-form-${m.id}`} style={{ border: '1px solid var(--warn)', borderRadius: 8, padding: 10, margin: '8px 0', background: 'rgba(255,180,0,0.06)' }}>
      <h3>提出失败处理方案 · {m.name}</h3>
      <p className="muted">关联制作人：{d.memento_case_users?.[m.artisan_id]?.name || `#${m.artisan_id}`}；
        剩余可用材料：{m.material_name} <b>{m.material_remaining}</b> 份</p>
      <div className="grid3">
        <div><label>处理方式</label>
          <select value={option} onChange={e => {
            setOption(e.target.value);
            setFee(e.target.value === 'refund' ? '-180' : '0');
          }}>
            <option value="remake">重做（占用 1 份剩余材料，承诺 3 日交付）</option>
            <option value="refund">退款（不再制作）</option>
            <option value="alternative">替代纪念品</option>
          </select>
        </div>
        <div><label>费用调整（负数退款/冲减）</label>
          <input type="number" value={fee} onChange={e => setFee(e.target.value)} /></div>
        {option === 'alternative' && <div><label>替代纪念品名称</label>
          <input value={alt} onChange={e => setAlt(e.target.value)} placeholder="如：琉璃毛发挂坠" /></div>}
      </div>
      <label style={{ marginTop: 6 }}>不可逆风险告知（主人确认前必读，必填）</label>
      <textarea rows={2} style={{ width: '100%' }} value={risk} onChange={e => setRisk(e.target.value)} />
      <label>补充说明</label>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="如：加急制作、赠送周年照" />
      <div className="pill-actions" style={{ marginTop: 6 }}>
        <button className="small ok" onClick={submit}>提交主管复核</button>
      </div>
    </div>
  );
}

function MementoCaseList({ d, role, canCs, act, reload }: any) {
  const cases: any[] = d.memento_cases || [];
  if (!cases.length) return null;
  const users = d.memento_case_users || {};
  const memMap = new Map<number, any>(d.mementos.map((m: any) => [m.id, m]));
  // 只有被驳回/主人拒绝的失败纪念品才展示新的提案表单
  const failedIds = new Set<number>();
  d.mementos.forEach((m: any) => {
    if (m.status !== 'failed') return;
    const c = cases.filter(x => x.memento_id === m.id).pop();
    if (!c || ['review_rejected', 'owner_rejected'].includes(c.status)) failedIds.add(m.id);
  });

  return (
    <div style={{ marginTop: 10 }}>
      {[...failedIds].map(mid => (
        <CaseProposeForm key={mid} m={memMap.get(mid)} d={d} act={act} />
      ))}
      {cases.map(c => {
        const m = memMap.get(c.memento_id);
        return (
          <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, margin: '8px 0' }}>
            <div className="row" style={{ alignItems: 'center' }}>
              <b>#{c.id} {m?.name}</b>
              <span className={`tag ${caseStatusTag(c.status)}`} style={{ marginLeft: 6 }}>{CASE_STATUS_LABEL[c.status]}</span>
              <span className="tag info" style={{ marginLeft: 6 }}>{CASE_OPTION_LABEL[c.option]}</span>
              {c.alternative_name && <span className="tag" style={{ marginLeft: 6 }}>{c.alternative_name}</span>}
              <span style={{ flex: 1 }} />
              <b className="mono" style={{ color: Number(c.fee_delta) < 0 ? 'var(--ok)' : (Number(c.fee_delta) > 0 ? 'var(--warn)' : undefined) }}>
                费用 {Number(c.fee_delta) === 0 ? '不调整' : yuan(c.fee_delta)}
              </b>
            </div>
            <dl className="kv" style={{ marginTop: 6 }}>
              <dt>制作人 / 材料</dt>
              <dd>{c.artisan_id ? (users[c.artisan_id]?.name || `#${c.artisan_id}`) : '—'} ·
                {' '}{c.material_name}：失败余 {c.material_on_fail} 份
                {['applied', 'finance_done', 'closed'].includes(c.status) ? ` → 处理后 ${c.material_after} 份` : ''}</dd>
              <dt>客服 / 主管</dt>
              <dd>{c.cs_id ? users[c.cs_id]?.name || `#${c.cs_id}` : '—'}
                {' / '}{c.supervisor_id
                  ? `${users[c.supervisor_id]?.name || c.supervisor_id}（${c.review_status === 'approved' ? '通过' : '驳回'}：${c.review_note || '—'}）`
                  : <span className="muted">待复核</span>}</dd>
              <dt>不可逆风险</dt><dd style={{ color: 'var(--warn)' }}>⚠ {c.risk_notice}</dd>
              {c.option_note && <><dt>补充</dt><dd>{c.option_note}</dd></>}
              {c.owner_decided_at && <><dt>主人决定</dt>
                <dd>{c.owner_decision === 'accepted' ? '✓ 已接受' : '✗ 不接受'}（{fmt(c.owner_decided_at)}）{c.owner_note ? `：${c.owner_note}` : ''}</dd></>}
              {c.option === 'remake' && c.remake_due_at && <><dt>重做排期</dt><dd>承诺 {fmt(c.remake_due_at)} 前交付</dd></>}
              {c.finance_handled_at && <><dt>财务</dt><dd>{fmt(c.finance_handled_at)} 确认入账{c.finance_note ? `：${c.finance_note}` : ''}</dd></>}
              {c.rating != null && <><dt>家属评价</dt><dd>{'★'.repeat(c.rating)}（{c.rating_note || '无备注'}，{fmt(c.rated_at)}）</dd></>}
            </dl>
            <div className="pill-actions">
              {(role === 'production_supervisor' || role === 'manager') && c.status === 'review_pending' && <>
                <button className="small ok" onClick={() => act(() => api('POST', `/api/memento-cases/${c.id}/review`,
                  { approve: true, note: '材料与费用评估合理，同意' }), '复核通过，已请主人确认')}>复核通过</button>
                <button className="small danger" onClick={() => {
                  const n = prompt('驳回原因？') || '请重新评估材料余量与费用';
                  act(() => api('POST', `/api/memento-cases/${c.id}/review`, { approve: false, note: n }), '已驳回');
                }}>驳回重提</button>
              </>}
              {role === 'finance' && c.status === 'applied' && <>
                <button className="small ok" onClick={() => act(() => api('POST', `/api/memento-cases/${c.id}/finance-confirm`,
                  { note: '费用调整已核对入账' }), '财务已确认')}>确认费用入账</button>
                {Number(c.fee_delta) < 0 && <button className="small danger" onClick={() => {
                  const v = prompt('退款金额？', String(Math.abs(Number(c.fee_delta)))) || '';
                  if (!v) return;
                  act(() => api('POST', `/api/appointments/${c.appointment_id}/refund`,
                    { amount: Number(v), reason: `纪念品失败处理退款（${m?.name}）`, case_id: c.id }), '退款已登记');
                }}>登记退款</button>}
              </>}
              {role === 'owner' && ['applied', 'finance_done'].includes(c.status) && (
                <button className="small" onClick={() => {
                  const r = prompt('请为本次失败处理评分（1-5）？', '5');
                  if (!r) return;
                  const n = prompt('评价备注？') || '';
                  act(() => api('POST', `/api/memento-cases/${c.id}/rate`, { rating: Number(r), note: n }), '感谢评价，处理单已闭环');
                }}>评价处理结果</button>
              )}
              {canCs && ['review_rejected', 'owner_rejected'].includes(c.status) && (
                <button className="small" onClick={() => document.getElementById(`case-form-${c.memento_id}`)
                  ?.scrollIntoView({ behavior: 'smooth' })}>修订/重新提案</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function ShipmentTag({ s }: { s: string }) {
  const map: any = { in_transit: ['在途', 'info'], delivered: ['已送达', ''], damaged: ['破损', 'bad'], resent: ['已补发', 'warn'], claimed: ['已签收', 'ok'] };
  const [t, c] = map[s] || [s, ''];
  return <span className={`tag ${c}`}>{t}</span>;
}
function LockerTag({ s }: { s: string }) {
  const map: any = { free: ['空闲', ''], occupied: ['占用中', 'info'], expiring: ['30天内到期', 'warn'], expired: ['已到期', 'bad'] };
  const [t, c] = map[s] || [s, ''];
  return <span className={`tag ${c}`} style={{ marginLeft: 6 }}>{t}</span>;
}
