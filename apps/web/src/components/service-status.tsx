'use client';

import { useEffect, useState } from 'react';

type ServiceState = 'checking' | 'healthy' | 'unreachable';

export type ProviderMode = 'real' | 'demo' | 'image';

const PROVIDER_CHIP: Record<ProviderMode, { icon: string; label: string }> = {
  real: { icon: '✦', label: '真实模型' },
  image: { icon: '✧', label: '真实图像生成' },
  demo: { icon: '◇', label: '固定样例' },
};

export function ServiceStatus({ providerMode }: { providerMode: ProviderMode }) {
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
    <div className="service-status" role="status" aria-live="polite">
      <div className={`service-item service-${state}`}>
        <span className="service-dot" aria-hidden="true" />
        <span>
          <small>Studio API</small>
          <strong>
            {state === 'checking' && '正在连接'}
            {state === 'healthy' && '服务在线'}
            {state === 'unreachable' && '连接失败'}
          </strong>
        </span>
        <span
          className={`badge ${state === 'healthy' ? 'badge-ok' : state === 'unreachable' ? 'badge-error' : 'badge-idle'}`}
        >
          {state === 'checking' ? '检测中' : state === 'healthy' ? '正常' : '不可用'}
        </span>
      </div>
      <div className={`provider-chip provider-${providerMode}`}>
        <span aria-hidden="true">{PROVIDER_CHIP[providerMode].icon}</span>
        <span>
          <small>Generation</small>
          <strong>{PROVIDER_CHIP[providerMode].label}</strong>
        </span>
      </div>
    </div>
  );
}
