'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import {
  api, CASE_OPTION_LABEL, CASE_STATUS_LABEL, caseStatusTag, fmt, getSession, yuan,
} from '../lib';

const TABS: [string, string][] = [
  ['review_pending', '待主管复核'],
  ['owner_pending', '待主人确认'],
  ['review_rejected', '主管驳回'],
  ['owner_rejected', '主人不接受'],
  ['applied', '已执行'],
  ['finance_done', '财务已入账'],
  ['closed', '已评价闭环'],
  ['', '全部'],
];

export default function MementoCasesPage() {
  const [s, setS] = useState<any>(null);
  const [tab, setTab] = useState('review_pending');
  const [rows, setRows] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => setS(getSession()), []);
  const role = s?.user?.role;

  async function load() {
    setRows(await api('GET', `/api/memento-cases${tab ? `?status=${tab}` : ''}`));
  }
  useEffect(() => { if (s) load(); /* eslint-disable-next-line */ }, [tab, s]);

  // 制作主管进入时默认看待复核
  useEffect(() => {
    if (role === 'production_supervisor') setTab('review_pending');
  }, [role]);

  async function review(c: any, approve: boolean) {
    const note = prompt(approve ? '复核意见（通过后向主人发出确认）？' : '驳回原因（客服将修订重提）？')
      || (approve ? '同意处理方案' : '材料/费用评估不合理，请重新提案');
    try {
      await api('POST', `/api/memento-cases/${c.id}/review`, { approve, note });
      setMsg(approve ? '已复核通过，等待主人确认' : '已驳回，等待客服修订');
      load();
    } catch (e: any) { alert(e.message); }
  }

  if (!s) return <AppShell><div className="panel">加载中…</div></AppShell>;
  const canReview = ['production_supervisor', 'manager'].includes(role);

  return (
    <AppShell>
      <h1>纪念品制作失败处理</h1>
      <div className="panel">
        <p className="muted">
          爪印泥 / 毛发纪念瓶制作失败后，平台在此关联<b>制作人、剩余可用材料与主人选择</b>：
          客服提出重做、退款或替代纪念品方案并说明不可逆风险 → 制作主管复核 → 主人确认；
          确认后费用调整与制作排期同步更新（费用同步财务、排期同步制作人），最后由家属评价闭环。
        </p>
        <div className="pill-actions" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          {TABS.map(([k, l]) =>
            <button key={k || 'all'} className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {msg && <div className="ok-msg">{msg}</div>}
        {rows.length === 0 ? <p className="muted">暂无处理单</p> : (
          <table>
            <thead><tr>
              <th>工单/宠物</th><th>纪念品</th><th>制作人 / 剩余材料</th><th>方案</th>
              <th>费用调整</th><th>状态</th><th>关键时间</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/appointments/${c.appointment_id}`}>#{c.appointment_id} {c.appointment?.pet_name}</Link>
                    <div className="muted mono">{c.appointment?.code}</div>
                  </td>
                  <td>#{c.memento_id}
                    <div className="muted">失败原因：{c.fail_reason}</div>
                    {c.alternative_name && <div className="muted">替代：{c.alternative_name}</div>}
                  </td>
                  <td>
                    {c.artisan?.name || `#${c.artisan_id}` || '—'}
                    <div className="muted">
                      {c.material_name}：失败余 {c.material_on_fail} 份
                      {['applied', 'finance_done', 'closed'].includes(c.status)
                        ? ` → 处理后 ${c.material_after} 份` : ''}
                    </div>
                  </td>
                  <td>
                    <span className="tag info">{CASE_OPTION_LABEL[c.option]}</span>
                    <div className="muted">客服：{c.cs?.name || `#${c.cs_id}`}
                      {c.supervisor ? ` · 主管：${c.supervisor.name}` : ''}</div>
                  </td>
                  <td className="mono" style={{ color: Number(c.fee_delta) < 0 ? 'var(--ok)' : (Number(c.fee_delta) > 0 ? 'var(--warn)' : undefined) }}>
                    {Number(c.fee_delta) === 0 ? '不调整' : yuan(c.fee_delta)}
                  </td>
                  <td><span className={`tag ${caseStatusTag(c.status)}`}>{CASE_STATUS_LABEL[c.status]}</span>
                    {c.rating != null && <div className="muted">家属评价 {'★'.repeat(c.rating)}</div>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    提案 {fmt(c.proposed_at)}<br />
                    {c.reviewed_at && <>复核 {fmt(c.reviewed_at)}<br /></>}
                    {c.owner_decided_at && <>主人 {fmt(c.owner_decided_at)}<br /></>}
                    {c.remake_due_at && c.option === 'remake' && <>重做承诺 {fmt(c.remake_due_at)}</>}
                  </td>
                  <td>
                    <div className="pill-actions">
                      {canReview && c.status === 'review_pending' && <>
                        <button className="small ok" onClick={() => review(c, true)}>复核通过</button>
                        <button className="small danger" onClick={() => review(c, false)}>驳回</button>
                      </>}
                      <Link className="btn ghost small" href={`/appointments/${c.appointment_id}`}>工单详情</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
