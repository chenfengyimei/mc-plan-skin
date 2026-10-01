'use client';

import { useEffect, useState } from 'react';

type ServiceState = 'checking' | 'healthy' | 'unreachable';

export function ServiceStatus() {
  const [state, setState] = useState<ServiceState>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const response = await fetch('/api/health/live');
        if (!cancelled) {
          setState(response.ok ? 'healthy' : 'unreachable');
        }
      } catch {
        if (!cancelled) {
          setState('unreachable');
        }
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="status-card">
      <strong>API 服务状态：</strong>
      {state === 'checking' && <span className="badge badge-idle">检测中</span>}
      {state === 'healthy' && <span className="badge badge-ok">正常</span>}
      {state === 'unreachable' && <span className="badge badge-error">不可用</span>}
      <p className="muted">运行模式：standalone（未接入 MC Plan 账号体系）</p>
    </div>
  );
}
