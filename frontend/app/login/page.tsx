'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, setSession } from '../lib';

const DEMO = [
  ['owner1', '宠物主人 · 王女士'],
  ['cs1', '客服 · 周敏（星河路店）'],
  ['driver1', '接送员 · 老赵'],
  ['rite1', '礼仪师 · 安然'],
  ['fire1', '火化师 · 郑师傅'],
  ['art1', '纪念品制作 · 阿岚'],
  ['artm1', '纪念品制作主管 · 苏晴'],
  ['fin1', '财务 · 唐会计'],
  ['manager1', '管理者 · 林总（全部门店）'],
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setU] = useState('owner1');
  const [password, setP] = useState('123456');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function go(u = username, p = password) {
    setErr(''); setLoading(true);
    try {
      const r = await api('POST', '/auth/login', { username: u, password: p });
      setSession(r);
      router.push('/appointments');
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }

  return (
    <div className="login-wrap">
      <div className="hero">
        <h1>🕯 暖归 · 宠物善终服务平台</h1>
        <p>预约告别、单独火化、骨灰寄存与纪念品，多角色围绕同一只宠物温柔协同。</p>
      </div>
      <div className="panel">
        <h2>登录</h2>
        {err && <div className="error">{err}</div>}
        <label>账号</label>
        <input value={username} onChange={e => setU(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <label>密码</label>
        <input type="password" value={password} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <div style={{ marginTop: 12 }}>
          <button onClick={() => go()} disabled={loading}>{loading ? '登录中…' : '登录'}</button>
          <Link className="btn ghost" href="/register">注册主人账号</Link>
        </div>
        <hr className="soft" />
        <h3>一键体验测试账号（密码均 123456）</h3>
        <div className="pill-actions">
          {DEMO.map(([u, label]) => (
            <button key={u} className="ghost small" onClick={() => { setU(u); setP('123456'); go(u, '123456'); }}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
