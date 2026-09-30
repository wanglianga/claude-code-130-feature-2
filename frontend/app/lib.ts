'use client';

export const API = process.env.NEXT_PUBLIC_API || 'http://127.0.0.1:4000';

export type Session = { token: string; user: any };

export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('pa_session');
  return raw ? JSON.parse(raw) : null;
}
export function setSession(s: Session | null) {
  if (s) localStorage.setItem('pa_session', JSON.stringify(s));
  else localStorage.removeItem('pa_session');
}

export async function api(method: string, path: string, body?: any): Promise<any> {
  const s = getSession();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(s ? { Authorization: `Bearer ${s.token}` } : {}),
    },
    body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray(data.message) ? data.message.join('；') : (data.message || `请求失败 ${res.status}`);
    throw new Error(m);
  }
  return data;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: '宠物主人',
  customer_service: '客服',
  driver: '接送员',
  ceremonialist: '礼仪师',
  cremator: '火化师',
  artisan: '纪念品制作',
  production_supervisor: '制作主管',
  finance: '财务',
  manager: '管理者',
};

export const STATUS_LABEL: Record<string, string> = {
  submitted: '待客服确认',
  cs_confirmed: '方案待家属确认',
  scheduled: '已调度',
  picked_up: '已接运',
  in_storage: '冷藏暂存中',
  farewell: '告别仪式中',
  cremating: '火化中',
  fulfilled: '火化完成待收尾',
  completed: '已完结',
  cancelled: '已取消',
};

export function statusTag(s: string) {
  const map: Record<string, string> = {
    submitted: 'warn', cs_confirmed: 'info', scheduled: 'info', picked_up: '',
    in_storage: 'info', farewell: 'warn', cremating: 'warn', fulfilled: '',
    completed: 'ok', cancelled: 'bad',
  };
  return map[s] || '';
}

export function fmt(d?: string | Date | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(+dt)) return '—';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export function yuan(v: any) { return `¥${Number(v || 0).toFixed(2)}`; }

export const PET_LABEL: Record<string, string> = {
  cat: '猫', dog: '犬', rabbit: '兔', exotic: '异宠',
};

export const TRIGGER_LABEL: Record<string, string> = {
  routine: '常规回访',
  memento_failed: '纪念品失败关怀',
  urn_damaged: '骨灰盒破损关怀',
  locker_expiring: '柜位临期提醒',
  locker_expired: '到期未续费跟进',
  post_service: '服务后情绪安抚',
};

export const CASE_OPTION_LABEL: Record<string, string> = {
  remake: '重做（占用剩余材料）',
  refund: '退款',
  alternative: '替代纪念品',
};

export const CASE_STATUS_LABEL: Record<string, string> = {
  review_pending: '待制作主管复核',
  review_rejected: '主管驳回待修订',
  owner_pending: '待主人确认',
  owner_rejected: '主人不接受待重新协商',
  applied: '已执行（费用/排期已同步）',
  finance_done: '财务已确认入账',
  closed: '已评价闭环',
};

export function caseStatusTag(s: string) {
  const map: Record<string, string> = {
    review_pending: 'warn', review_rejected: 'bad', owner_pending: 'warn',
    owner_rejected: 'bad', applied: 'ok', finance_done: 'ok', closed: 'ok',
  };
  return map[s] || '';
}
