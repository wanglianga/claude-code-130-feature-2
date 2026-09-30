'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSession, ROLE_LABEL, setSession } from './lib';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [s, setS] = useState<any>(null);
  useEffect(() => setS(getSession()), []);
  if (!s) return null;
  const role = s.user.role;
  const nav: { href: string; label: string; roles: string[] }[] = [
    { href: '/appointments', label: '服务工单', roles: ['owner', 'customer_service', 'driver', 'ceremonialist', 'cremator', 'artisan', 'production_supervisor', 'finance', 'manager'] },
    { href: '/new', label: '我要预约', roles: ['owner'] },
    { href: '/followups', label: '回访中心', roles: ['customer_service', 'manager'] },
    { href: '/memento-cases', label: '纪念品失败处理', roles: ['customer_service', 'production_supervisor', 'artisan', 'finance', 'manager'] },
    { href: '/lockers', label: '寄存柜位', roles: ['customer_service', 'manager'] },
    { href: '/overview', label: '管理总览', roles: ['manager'] },
  ];
  const items = nav.filter(n => n.roles.includes(role));
  return (
    <>
      <div className="nav">
        <Link href="/appointments" className="brand">🕯 暖归宠物善终平台</Link>
        {items.map(n => (
          <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? 'active' : ''}>{n.label}</Link>
        ))}
        <span className="spacer" />
        <span className="muted">{s.user.name} · {ROLE_LABEL[role]}</span>
        <button className="ghost small" onClick={() => { setSession(null); router.push('/login'); }}>退出</button>
      </div>
      <div className="container">{children}</div>
    </>
  );
}
