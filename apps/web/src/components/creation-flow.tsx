'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { SkinPreview } from './skin-preview';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface ConversationInfo {
  conversation_id: string;
  status: string;
  attempts_used: number;
  attempts_limit: number;
  expires_at: string;
}

interface RenderEntry {
  jobId: string;
  status: JobStatus;
  candidateId: string | null;
  errorCode: string | null;
  armModel: 'steve' | 'alex';
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': newIdempotencyKey() },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: response.ok, status: response.status, data };
}

/** Standalone 最小创作流程：创建 → 渲染（最多三次）→ 在线预览 → 确认成品。
 * 预览通过本地演示路由（demo-preview）提供；最终下载仍待公共契约补全。 */
export function CreationFlow() {
  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [initialInput, setInitialInput] = useState('');
  const [renderInput, setRenderInput] = useState('');
  const [armModel, setArmModel] = useState<'steve' | 'alex'>('steve');
  const [renders, setRenders] = useState<RenderEntry[]>([]);
  const [previewBytes, setPreviewBytes] = useState<Record<string, Uint8Array>>({});
  const [finalizeJobId, setFinalizeJobId] = useState<string | null>(null);
  const [finalizeStatus, setFinalizeStatus] = useState<JobStatus | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const current = timers.current;
    return () => {
      for (const timer of current) {
        clearTimeout(timer);
      }
    };
  }, []);

  const pollJob = useCallback(
    async (
      jobId: string,
      onUpdate: (status: JobStatus, candidateId: string | null, errorCode: string | null) => void,
    ) => {
      const poll = async (): Promise<void> => {
        try {
          const response = await fetch(`/api/v1/jobs/${jobId}`);
          if (!response.ok) {
            setError(`任务查询失败（${response.status}）`);
            return;
          }
          const job = (await response.json()) as {
            status: JobStatus;
            candidate_id: string | null;
            error_code: string | null;
          };
          onUpdate(job.status, job.candidate_id, job.error_code);
          if (job.status === 'queued' || job.status === 'running') {
            const timer = setTimeout(() => void poll(), 2000);
            timers.current.push(timer);
          }
        } catch (pollError) {
          setError(`任务查询失败：${(pollError as Error).message}`);
        }
      };
      await poll();
    },
    [],
  );

  const loadPreview = useCallback(
    async (candidateId: string, model: 'steve' | 'alex') => {
      if (previewBytes[candidateId]) {
        return;
      }
      try {
        const response = await fetch(`/demo-preview/${candidateId}`);
        if (!response.ok) {
          return;
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        setPreviewBytes((prev) => ({ ...prev, [candidateId]: bytes }));
        void model;
      } catch {
        // 预览失败不影响主流程
      }
    },
    [previewBytes],
  );

  const startConversation = useCallback(async (): Promise<void> => {
    if (initialInput.trim().length === 0) {
      setError('请先描述你想要的皮肤');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson('/api/v1/conversations', {
      initial_message: initialInput,
    });
    setBusy(false);
    if (!result.ok) {
      const problem = result.data as { detail?: string } | null;
      setError(problem?.detail ?? `创建会话失败（${result.status}）`);
      return;
    }
    setConversation(result.data as ConversationInfo);
    setRenderInput(initialInput);
  }, [initialInput]);

  const requestRender = useCallback(async (): Promise<void> => {
    if (!conversation || renderInput.trim().length === 0) {
      setError('请输入渲染描述');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/v1/conversations/${conversation.conversation_id}/renders`, {
      message: renderInput,
      preferred_arm_model: armModel,
    });
    setBusy(false);
    if (!result.ok) {
      const problem = result.data as { code?: string; detail?: string } | null;
      setError(
        problem?.code === 'SKIN_ATTEMPTS_EXHAUSTED'
          ? '渲染次数已用完（最多三次）'
          : (problem?.detail ?? `请求渲染失败（${result.status}）`),
      );
      return;
    }
    const accepted = result.data as { job_id: string };
    setRenders((prev) => [
      ...prev,
      { jobId: accepted.job_id, status: 'queued', candidateId: null, errorCode: null, armModel },
    ]);
    void pollJob(accepted.job_id, (status, candidateId, errorCode) => {
      setRenders((prev) =>
        prev.map((entry) =>
          entry.jobId === accepted.job_id ? { ...entry, status, candidateId, errorCode } : entry,
        ),
      );
      if (status === 'succeeded' && candidateId) {
        void loadPreview(candidateId, armModel);
      }
    });
  }, [conversation, renderInput, armModel, pollJob, loadPreview]);

  const finalize = useCallback(
    async (candidateId: string): Promise<void> => {
      if (!conversation || title.trim().length === 0) {
        setError('请为成品填写标题');
        return;
      }
      setBusy(true);
      setError(null);
      const result = await postJson(
        `/api/v1/conversations/${conversation.conversation_id}/finalize`,
        { candidate_id: candidateId, title, description },
      );
      setBusy(false);
      if (!result.ok) {
        const problem = result.data as { detail?: string } | null;
        setError(problem?.detail ?? `确认成品失败（${result.status}）`);
        return;
      }
      const accepted = result.data as { job_id: string };
      setFinalizeJobId(accepted.job_id);
      setFinalizeStatus('queued');
      void pollJob(accepted.job_id, (status) => setFinalizeStatus(status));
    },
    [conversation, title, description, pollJob],
  );

  const candidates = renders
    .map((entry) => ({ candidateId: entry.candidateId, armModel: entry.armModel }))
    .filter(
      (entry): entry is { candidateId: string; armModel: 'steve' | 'alex' } =>
        entry.candidateId !== null,
    );

  return (
    <div className="flow">
      {!conversation ? (
        <section className="card">
          <h2>描述你的皮肤</h2>
          <textarea
            aria-label="皮肤描述"
            value={initialInput}
            onChange={(event) => setInitialInput(event.target.value)}
            placeholder="例如：一位戴着蓝色围巾、背着雪橇的极地探险家"
            rows={4}
          />
          <button type="button" disabled={busy} onClick={() => void startConversation()}>
            开始创作
          </button>
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <>
          <section className="card">
            <h2>创作会话</h2>
            <p data-testid="conversation-state">
              状态：{conversation.status} · 渲染次数 {renders.length}/{conversation.attempts_limit}
            </p>
            <textarea
              aria-label="渲染描述"
              value={renderInput}
              onChange={(event) => setRenderInput(event.target.value)}
              rows={3}
            />
            <label>
              手臂模型：
              <select
                value={armModel}
                onChange={(event) => setArmModel(event.target.value as 'steve' | 'alex')}
              >
                <option value="steve">Steve（4px 手臂）</option>
                <option value="alex">Alex（3px 手臂）</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy || renders.length >= conversation.attempts_limit}
              onClick={() => void requestRender()}
            >
              请求渲染（最多 {conversation.attempts_limit} 次）
            </button>
            {error && <p className="error">{error}</p>}
          </section>

          <section className="card">
            <h2>渲染状态</h2>
            <ul data-testid="render-list">
              {renders.map((entry, index) => (
                <li key={entry.jobId} data-testid={`render-${index}`}>
                  第 {index + 1} 次：{entry.status}
                  {entry.errorCode ? `（${entry.errorCode}）` : ''}
                  {entry.candidateId ? ` · 候选 ${entry.candidateId.slice(0, 8)}…` : ''}
                </li>
              ))}
            </ul>
          </section>

          {candidates.length > 0 && (
            <section className="card">
              <h2>候选预览与确认</h2>
              <ul data-testid="candidate-list" className="candidate-list">
                {candidates.map((candidate) => {
                  const bytes = previewBytes[candidate.candidateId];
                  return (
                    <li key={candidate.candidateId} className="candidate-item">
                      {bytes ? (
                        <SkinPreview bytes={bytes} armModel={candidate.armModel} scale={6} />
                      ) : (
                        <div className="preview-loading">预览加载中…</div>
                      )}
                      <button
                        type="button"
                        data-testid={`confirm-${candidate.candidateId.slice(0, 8)}`}
                        disabled={busy || finalizeJobId !== null}
                        onClick={() => void finalize(candidate.candidateId)}
                      >
                        确认成品 {candidate.candidateId.slice(0, 8)}…
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label>
                标题：
                <input
                  aria-label="成品标题"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                描述：
                <input
                  aria-label="成品描述"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={4000}
                />
              </label>
              <p className="muted">
                最终 PNG 下载依赖公共契约补全（缺口已记录，待 Contracts 工作流）。
              </p>
            </section>
          )}

          {finalizeJobId && (
            <section className="card">
              <h2>确认状态</h2>
              <p data-testid="finalize-status">确认任务：{finalizeStatus ?? '排队中'}</p>
              {finalizeStatus === 'succeeded' && (
                <p data-testid="finalize-done" className="success">
                  成品已确认（Standalone）。下载将在公共契约补全后开放。
                </p>
              )}
              {finalizeStatus === 'failed' && <p className="error">确认失败，可重试。</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
