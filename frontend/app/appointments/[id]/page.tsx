'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../../AppShell';
import {
  api, fmt, getSession, PET_LABEL, ROLE_LABEL, STATUS_LABEL, statusTag, yuan,
  FAILURE_STATUS_LABEL, failureStatusTag, RESOLUTION_LABEL,
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
          <MementoPanel a={a} d={d} role={role} canCs={canCs} act={act} />

          {/* 纪念品失败处理 */}
          {d.failure_cases?.length > 0 && (
            <FailureCasesPanel a={a} d={d} role={role} canCs={canCs} act={act} reload={load} />
          )}

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
  const subjectMap: any = { plan: '服务方案', fee_change: '费用变更', ceremony_time: '仪式时间改期', video_witness: '视频见证', memento_failure: '纪念品失败处理方案' };
  const isReschedule = c.subject === 'ceremony_time';
  return (
    <div style={{ borderBottom: '1px dashed var(--line)', paddingBottom: 10, marginBottom: 10 }}>
      <span className="tag warn">{subjectMap[c.subject] || c.subject} · 待处理</span>
      <p style={{ margin: '6px 0', whiteSpace: 'pre-line' }}>{String(c.content).replace(/\[(FEE|TIME|CASE)\].*?\[\/\1\]/g, '')}</p>
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
    <div className="panel"><h2>纪念品工作台</h2><p className="muted">请在右侧「纪念品制作」面板对制作单执行开始 / 失败登记（关联制作人、剩余材料、主人选择）/ 完成。失败处理方案经主人确认后，重做/替代单按新承诺时间制作，完成后送制作主管复核。</p></div>
  );

  // 纪念品制作主管
  if (role === 'artisan_supervisor') return (
    <div className="panel"><h2>制作主管工作台</h2><p className="muted">请在右侧「纪念品失败处理」面板查看失败立案、剩余材料与主人选择；重做/替代成品完成后在此<b>复核通过</b>（交付家属评价）或<b>退回重做</b>。复核结论与材料占用全程留痕。</p></div>
  );

  // 财务
  if (role === 'finance') return (
    <div className="panel"><h2>财务工作台</h2><p className="muted">纪念品失败处理经主人确认后，费用调整（重做补差 / 退款冲减 / 替代差价）会自动生成已确认费用项并同步到下方「费用明细与变化」与最终应收；请据此在费用面板核对台账、登记收款或退款。</p></div>
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
  const map: any = {
    pending: ['待制作', 'warn'], making: ['制作中', 'info'], failed: ['制作失败', 'bad'],
    remake: ['重做中', 'warn'], done: ['已完成', 'ok'],
    refunded: ['已退款·不交付', 'bad'], replaced: ['已被替代', 'warn'],
  };
  const [t, c] = map[s] || [s, ''];
  return <span className={`tag ${c}`}>{t}</span>;
}

function MementoPanel({ a, d, role, canCs, act }: any) {
  const [failFor, setFailFor] = useState<any>(null);
  const [form, setForm] = useState({ reason: '', remaining_materials: '', owner_choice: '', remaining_attempts: '1' });
  const canMake = ['artisan', 'artisan_supervisor', 'customer_service', 'manager'].includes(role);
  return (
    <div className="panel">
      <h2>纪念品制作（{d.mementos.length}）</h2>
      {d.mementos.length === 0 ? <p className="muted">本单无纪念品</p> : (
        <table>
          <thead><tr><th>项目</th><th>关联制作人</th><th>状态</th><th>承诺交付</th>{canMake && <th>操作</th>}</tr></thead>
          <tbody>
            {d.mementos.map((m: any) => {
              const artisan = d.failure_cases?.find((c: any) => c.artisan_id === m.artisan_id)?.artisan_name;
              return (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    {m.fail_reason && <div className="muted" style={{ color: 'var(--bad)' }}>失败原因：{m.fail_reason}</div>}
                    {m.remaining_materials && <div className="muted">剩余材料：{m.remaining_materials}</div>}
                    {m.owner_choice && <div className="muted">主人选择：{m.owner_choice}</div>}
                    {m.remake_material_used > 0 && <div className="muted">重做已占用材料 {m.remake_material_used} 份</div>}
                  </td>
                  <td className="muted">{artisan || (m.artisan_id ? `#${m.artisan_id}` : '未分配')}</td>
                  <td><MementoTag s={m.status} /></td>
                  <td>{fmt(m.due_at)}</td>
                  {canMake && (
                    <td className="pill-actions">
                      {m.status === 'pending' && <button className="small" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/start`, {}), '已开始制作')}>开始</button>}
                      {m.status === 'making' && <>
                        <button className="small danger" onClick={() => { setFailFor(m); setForm({ reason: '', remaining_materials: '', owner_choice: '', remaining_attempts: '1' }); }}>登记失败</button>
                        <button className="small ok" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/done`, { media: [] }), '已完成')}>完成</button>
                      </>}
                      {/* 已立失败处理工单的，重做须走客服方案→主人确认，见下方失败处理面板 */}
                      {m.status === 'failed' && !m.failure_case_id &&
                        <button className="small" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/remake`, {}), '已安排重做（3 日内交付）')}>安排重做</button>}
                      {m.status === 'failed' && m.failure_case_id && <span className="tag warn">等待失败处理方案</span>}
                      {(m.status === 'remake' || (m.failure_case_id && ['remake'].includes(m.status))) &&
                        <button className="small ok" onClick={() => act(() => api('POST', `/api/mementos/${m.id}/done`, { media: [] }), '已完成，等待主管复核')}>制作完成·送复核</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {failFor && (
        <div style={{ border: '1px solid var(--bad)', borderRadius: 8, padding: 12, marginTop: 10, background: 'var(--panel2, #faf6f2)' }}>
          <h3 style={{ marginTop: 0 }}>登记「{failFor.name}」制作失败</h3>
          <p className="muted">失败立案后将关联制作人、剩余可用材料与主人选择，并立即生成客服关怀回访；处理须由客服拟定重做/退款/替代方案并经主人确认。</p>
          <label>失败原因</label>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="如：脱模时泥坯开裂 / 毛发封存瓶渗漏" />
          <label>剩余可用材料（关键：决定能否重做）</label>
          <input value={form.remaining_materials} onChange={e => setForm({ ...form, remaining_materials: e.target.value })} placeholder="如：余泥 2 份 / 毛发余量 0.3g，仅够 1 次" />
          <label>主人原始选择</label>
          <input value={form.owner_choice} onChange={e => setForm({ ...form, owner_choice: e.target.value })} placeholder="如：深棕泥 + 名字刻字 / 银色吊坠瓶" />
          <label>剩余可重做次数</label>
          <input type="number" min="0" value={form.remaining_attempts} onChange={e => setForm({ ...form, remaining_attempts: e.target.value })} style={{ width: 120 }} />
          <div className="pill-actions" style={{ marginTop: 8 }}>
            <button className="small danger" onClick={() => {
              if (!form.reason) return alert('请填写失败原因');
              act(() => api('POST', `/api/mementos/${failFor.id}/fail`, {
                reason: form.reason, remaining_materials: form.remaining_materials,
                owner_choice: form.owner_choice, remaining_attempts: Number(form.remaining_attempts || 0),
              }), '已立失败处理工单并通知客服');
              setFailFor(null);
            }}>确认失败立案</button>
            <button className="small ghost" onClick={() => setFailFor(null)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FailureCasesPanel({ a, d, role, canCs, act, reload }: any) {
  return (
    <div className="panel">
      <h2>纪念品失败处理（{d.failure_cases.length}）</h2>
      <p className="muted">
        每个失败纪念品一条处理工单：客服提供<b>重做 / 退款 / 替代纪念品</b>，
        须说明<b>不可逆风险</b>与材料占用；主人确认后费用调整同步财务、制作排期同步更新；
        成品由<b>制作主管复核</b>，最后由<b>家属评价</b>结案。
      </p>
      {d.failure_cases.map((c: any) => (
        <FailureCaseCard key={c.id} c={c} role={role} canCs={canCs} act={act} reload={reload} />
      ))}
    </div>
  );
}

function FailureCaseCard({ c, role, canCs, act, reload }: any) {
  const [form, setForm] = useState<any>({
    resolution: 'remake', fee_adjustment: '0', fee_title: '', promised_at: '',
    irreversible_risk: '', material_consume: '', alternative_name: '', note: '',
  });
  const [show, setShow] = useState(false);
  const isOwner = role === 'owner';
  const isSupervisor = ['artisan_supervisor', 'manager'].includes(role);
  const dueDefault = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, margin: '10px 0' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <b>「{c.memento_name}」</b>
        <span className={`tag ${failureStatusTag(c.status)}`}>{FAILURE_STATUS_LABEL[c.status] || c.status}</span>
        {c.resolution && <span className="tag info">{RESOLUTION_LABEL[c.resolution]}</span>}
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted">制作人：{c.artisan_name || '—'} · 客服：{c.cs_name || '—'}</span>
      </div>

      <dl className="kv" style={{ marginTop: 6 }}>
        <dt>失败原因</dt><dd>{c.fail_reason || '—'}</dd>
        <dt>剩余可用材料</dt><dd style={{ color: c.remaining_materials ? undefined : 'var(--bad)' }}>{c.remaining_materials || '未登记'}{c.remaining_attempts > 0 ? `（可重做 ${c.remaining_attempts} 次）` : ''}</dd>
        <dt>主人选择</dt><dd>{c.owner_choice || '—'}</dd>
      </dl>

      {/* 已拟定方案展示（主人确认走顶部「待家属确认」；此处只读展示给各岗位） */}
      {c.proposed_at && c.resolution && (
        <div style={{ background: '#faf7f2', borderRadius: 6, padding: 8, margin: '6px 0' }}>
          <div>处理方案：<b>{RESOLUTION_LABEL[c.resolution]}</b>{c.alternative_name ? `（${c.alternative_name}）` : ''}</div>
          {Number(c.fee_adjustment) !== 0 && <div>费用调整：<b className="mono" style={{ color: Number(c.fee_adjustment) < 0 ? 'var(--ok)' : 'var(--bad)' }}>{yuan(c.fee_adjustment)}</b>（确认后同步财务）</div>}
          {c.promised_at && <div>承诺交付 / 制作排期：{fmt(c.promised_at)}</div>}
          {c.material_consume && <div>重做占用材料：{c.material_consume}</div>}
          {c.irreversible_risk && <div style={{ color: 'var(--bad)' }}>⚠ 不可逆风险：{c.irreversible_risk}</div>}
          {c.proposal_note && <div className="muted">备注：{c.proposal_note}</div>}
          {c.owner_confirmed_at && <div className="muted">主人已于 {fmt(c.owner_confirmed_at)} 确认{Number(c.fee_adjustment) !== 0 ? '，费用已入账' : ''}</div>}
        </div>
      )}

      {/* 主管复核结论 / 家属评价 */}
      {c.reviewed_at && (
        <div className="muted" style={{ marginTop: 4 }}>
          主管复核：{c.review_result === 'approved' ? '✅ 通过' : '↩ 退回重做'}（{c.supervisor_name} {fmt(c.reviewed_at)}）{c.review_note ? ` · ${c.review_note}` : ''}
        </div>
      )}
      {c.rating && (
        <div style={{ marginTop: 4 }}>家属评价：{'★'.repeat(c.rating)}<span className="muted">{'★'.repeat(5 - c.rating)} {c.rating_note || ''}</span></div>
      )}

      {/* 客服：拟定 / 重新拟定方案 */}
      {canCs && ['open', 'owner_rejected', 'proposed'].includes(c.status) && (
        <div style={{ marginTop: 8 }}>
          {!show ? <button className="small" onClick={() => { setShow(true); if (!form.promised_at) setForm(f => ({ ...f, promised_at: dueDefault })); }}>{c.status === 'proposed' ? '重新拟定方案' : '拟定处理方案'}</button> : (
            <div>
              <div className="row">
                <label>方案</label>
                <select value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })}>
                  <option value="remake">重做（占用剩余材料）</option>
                  <option value="refund">退款（不再制作）</option>
                  <option value="alternative">替代纪念品</option>
                </select>
              </div>
              <div className="grid3">
                <div><label>费用调整（负数退款）</label>
                  <input type="number" value={form.fee_adjustment} onChange={e => setForm({ ...form, fee_adjustment: e.target.value })} /></div>
                <div><label>费用项目名称</label>
                  <input value={form.fee_title} onChange={e => setForm({ ...form, fee_title: e.target.value })} placeholder="留空用默认名称" /></div>
                {form.resolution !== 'refund' && <div><label>承诺交付时间</label>
                  <input type="datetime-local" value={form.promised_at} onChange={e => setForm({ ...form, promised_at: e.target.value })} /></div>}
              </div>
              {form.resolution === 'alternative' && (
                <div><label>替代纪念品名称</label>
                  <input value={form.alternative_name} onChange={e => setForm({ ...form, alternative_name: e.target.value })} placeholder="如：水晶毛发吊坠 / 照片镌刻摆件" /></div>
              )}
              {form.resolution === 'remake' && <>
                <label>重做将占用的剩余材料（必填）</label>
                <input value={form.material_consume} onChange={e => setForm({ ...form, material_consume: e.target.value })} placeholder="如：剩余爪印泥 1 份（用后无备用）" />
                <label>不可逆风险告知（必填）</label>
                <input value={form.irreversible_risk} onChange={e => setForm({ ...form, irreversible_risk: e.target.value })} placeholder="如：剩余毛发/泥坯为唯一纪念材料，再次失败将无法重做" />
              </>}
              <label>方案备注</label>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
              <div className="pill-actions" style={{ marginTop: 6 }}>
                <button className="small ok" onClick={() => act(async () => {
                  await api('POST', `/api/memento-failures/${c.id}/propose`, {
                    resolution: form.resolution,
                    fee_adjustment: Number(form.fee_adjustment || 0),
                    fee_title: form.fee_title || undefined,
                    promised_at: form.resolution === 'refund' ? undefined : new Date(form.promised_at).toISOString(),
                    material_consume: form.material_consume || undefined,
                    irreversible_risk: form.irreversible_risk || undefined,
                    alternative_name: form.alternative_name || undefined,
                    note: form.note || undefined,
                  });
                  setShow(false);
                }, '方案已拟定，等待主人确认')}>提交方案给主人确认</button>
                <button className="small ghost" onClick={() => setShow(false)}>收起</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 制作人员：查看执行提示（重做/替代单在上方纪念品表操作） */}
      {role === 'artisan' && ['remake_confirmed', 'alternative_confirmed'].includes(c.status) && (
        <p className="tag info" style={{ marginTop: 6 }}>
          请在上方纪念品表按承诺时间 {fmt(c.promised_at)} 完成{c.resolution === 'alternative' ? `替代纪念品「${c.alternative_name}」` : '重做件'}，完成后自动送主管复核
        </p>
      )}

      {/* 制作主管复核 */}
      {isSupervisor && c.status === 'reviewing' && (
        <div className="pill-actions" style={{ marginTop: 8 }}>
          <button className="small ok" onClick={() => {
            const note = prompt('复核意见（通过）？') || '质量合格，同意交付';
            act(() => api('POST', `/api/memento-failures/${c.id}/review`, { approve: true, note }), '复核通过，等待家属评价');
          }}>复核通过</button>
          <button className="small danger" onClick={() => {
            const note = prompt('退回原因？') || '质量不达标，需重新制作';
            act(() => api('POST', `/api/memento-failures/${c.id}/review`, { approve: false, note }), '已退回重新制作');
          }}>退回重做</button>
        </div>
      )}

      {/* 家属评价 */}
      {isOwner && c.status === 'reviewed' && <RatingBox c={c} onDone={reload} />}
      {isOwner && c.status === 'proposed' && <p className="tag warn" style={{ marginTop: 6 }}>请在本页顶部「待家属确认」查看方案（含不可逆风险）后确认</p>}
    </div>
  );
}

function RatingBox({ c, onDone }: any) {
  const [rating, setRating] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div style={{ marginTop: 8 }}>
      <label>对本次失败处理结果评价</label>
      <div className="row">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" className="ghost small"
            style={{ fontWeight: n <= rating ? 'bold' : 'normal', color: n <= rating ? '#c8862d' : undefined }}
            onClick={() => setRating(n)}>{'★'.repeat(n)}</button>
        ))}
      </div>
      <input placeholder="评价留言（可选）" value={note} onChange={e => setNote(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <button className="small ok" disabled={busy} style={{ marginTop: 6 }} onClick={async () => {
        setBusy(true); setErr('');
        try { await api('POST', `/api/memento-failures/${c.id}/rate`, { rating, note }); onDone(); }
        catch (e: any) { setErr(e.message); setBusy(false); }
      }}>提交评价并结案</button>
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
