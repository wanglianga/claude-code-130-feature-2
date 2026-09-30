'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '../AppShell';
import { api, STATUS_LABEL } from '../lib';

export default function OverviewPage() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api('GET', '/api/manager/overview').then(setD); }, []);
  if (!d) return <AppShell><div className="panel">加载中…</div></AppShell>;

  return (
    <AppShell>
      <h1>管理者总览（跨门店）</h1>
      <div className="grid3">
        <div className="stat"><div className="n">{d.total}</div><div className="l">服务工单总数</div></div>
        <div className="stat"><div className="n" style={{ color: d.open_exceptions ? 'var(--bad)' : 'var(--ok)' }}>{d.open_exceptions}</div><div className="l">未闭环异常节点</div></div>
        <div className="stat"><div className="n">¥{Number(d.payable_total).toFixed(0)}</div><div className="l">应收总额</div></div>
        <div className="stat"><div className="n" style={{ color: 'var(--ok)' }}>¥{Number(d.paid_total).toFixed(0)}</div><div className="l">已收净额（扣退款）</div></div>
        <div className="stat"><div className="n" style={{ color: d.expiring_lockers ? 'var(--warn)' : undefined }}>{d.expiring_lockers}</div><div className="l">柜位临期/过期</div></div>
        <div className="stat"><div className="n" style={{ color: d.failed_mementos ? 'var(--bad)' : undefined }}>{d.failed_mementos}</div><div className="l">纪念品失败/重做中</div></div>
        <div className="stat"><div className="n" style={{ color: d.open_failure_cases ? 'var(--warn)' : 'var(--ok)' }}>{d.open_failure_cases || 0}</div><div className="l">失败处理未结案</div></div>
        <div className="stat"><div className="n" style={{ color: d.failure_review_pending ? 'var(--warn)' : undefined }}>{d.failure_review_pending || 0}</div><div className="l">待制作主管复核</div></div>
        <div className="stat"><div className="n" style={{ color: (d.memento_rating_avg || 0) < 4 ? 'var(--warn)' : 'var(--ok)' }}>{d.memento_rating_avg == null ? '—' : `${d.memento_rating_avg}★`}</div><div className="l">家属失败处理评分（{d.memento_rating_count || 0}）</div></div>
        <div className="stat"><div className="n" style={{ color: d.pending_fees ? 'var(--warn)' : undefined }}>{d.pending_fees}</div><div className="l">待家属确认费用变更</div></div>
        <div className="stat"><div className="n" style={{ color: d.breached_promises.length ? 'var(--bad)' : undefined }}>{d.breached_promises.length}</div><div className="l">承诺时间疑似超期</div></div>
      </div>

      <div className="panel">
        <h2>各状态工单分布</h2>
        <div className="pill-actions">
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <span key={k} className="tag">{v}：{d.status_count[k] || 0}</span>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>承诺时间超期预警</h2>
          {d.breached_promises.length === 0 ? <p className="muted">暂无超期承诺</p> : (
            <table>
              <thead><tr><th>工单</th><th>节点</th><th>承诺时间</th></tr></thead>
              <tbody>{d.breached_promises.map((b: any, i: number) => (
                <tr key={i}>
                  <td><Link href={`/appointments/${b.appointment_id}`}>#{b.appointment_id} {b.title}</Link></td>
                  <td className="mono">{b.node}</td><td>{new Date(b.promised_at).toLocaleString('zh-CN')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <h2>门店服务点</h2>
          <table>
            <thead><tr><th>门店</th><th>地址</th><th>电话</th></tr></thead>
            <tbody>{d.stores.map((s: any) => (
              <tr key={s.id}><td>#{s.id} {s.name}</td><td>{s.address}</td><td>{s.phone}</td></tr>
            ))}</tbody>
          </table>
          <p className="muted">宠物医院转介在主人下单时选择；员工只能访问所属门店数据，管理者可查看全部门店。</p>
        </div>
      </div>
    </AppShell>
  );
}
