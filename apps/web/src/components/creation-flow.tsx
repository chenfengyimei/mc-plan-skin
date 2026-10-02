'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ProviderMode } from './service-status';
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

const PROMPT_STARTERS = [
  '月光下的银发暗夜骑士，靛蓝披风与星纹护肩',
  '复古街机风机械师，荧光绿线路与透明护目镜',
  '樱花主题的旅行剑客，浅粉羽织与深色腰封',
] as const;

const WORKFLOW_STEPS = [
  ['01', '构思', '描述角色'],
  ['02', '生成', '逐像素绘制'],
  ['03', '检查', '3D 动态预览'],
  ['04', '定稿', '确认候选'],
] as const;

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: '等待生成',
  running: '正在绘制',
  succeeded: '候选完成',
  failed: '生成失败',
  cancelled: '已取消',
};

const ERROR_MESSAGES: Record<string, string> = {
  PROVIDER_UNAVAILABLE:
    '真实生成服务当前不可用。请检查模型端点、额度或计费状态；如果服务返回 HTTP 402，需要先恢复 Provider 额度。',
  PROVIDER_TIMEOUT: '模型响应超时，本次没有生成候选。可以调整描述后再次尝试。',
  PROVIDER_REJECTED: '模型拒绝了这次生成请求，请调整描述中的敏感或冲突内容。',
  SKIN_VALIDATION_FAILED: '模型返回的皮肤没有通过 64×64 双层结构校验，本次不会显示为有效候选。',
  MISSING_SECOND_LAYER: '候选缺少有效第二层细节，已被校验器拒绝。',
};

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
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function errorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? `生成任务失败（${code}）`;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '30 天后';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function WorkflowRail({ current }: { current: number }) {
  return (
    <ol className="workflow-rail" aria-label="创作进度">
      {WORKFLOW_STEPS.map(([number, title, detail], index) => {
        const step = index + 1;
        return (
          <li
            key={number}
            className={step === current ? 'is-current' : step < current ? 'is-complete' : ''}
            aria-current={step === current ? 'step' : undefined}
          >
            <span>{step < current ? '✓' : number}</span>
            <div>
              <strong>{title}</strong>
              <small>{detail}</small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Standalone 创作工作台：创建 → 真实/演示 Provider 渲染 → 3D 检查 → 确认。 */
export function CreationFlow({ providerMode }: { providerMode: ProviderMode }) {
  const [conversation, setConversation] = useState<ConversationInfo | null>(null);
  const [initialInput, setInitialInput] = useState('');
  const [renderInput, setRenderInput] = useState('');
  const [armModel, setArmModel] = useState<'steve' | 'alex'>('steve');
  const [renders, setRenders] = useState<RenderEntry[]>([]);
  const [previewBytes, setPreviewBytes] = useState<Record<string, Uint8Array>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
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
      for (const timer of current) clearTimeout(timer);
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
          if (job.status === 'failed') setError(errorMessage(job.error_code));
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

  const loadPreview = useCallback(async (candidateId: string) => {
    try {
      const response = await fetch(`/demo-preview/${candidateId}`);
      if (!response.ok) return;
      const bytes = new Uint8Array(await response.arrayBuffer());
      setPreviewBytes((previous) =>
        previous[candidateId] ? previous : { ...previous, [candidateId]: bytes },
      );
    } catch {
      // 候选已经安全保存；预览路由短暂失败不改变任务状态。
    }
  }, []);

  const startConversation = useCallback(async (): Promise<void> => {
    if (initialInput.trim().length === 0) {
      setError('请先描述你想创造的角色和关键视觉细节。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postJson('/api/v1/conversations', {
        initial_message: initialInput.trim(),
      });
      if (!result.ok) {
        const problem = result.data as { detail?: string } | null;
        setError(problem?.detail ?? `创建会话失败（${result.status}）`);
        return;
      }
      setConversation(result.data as ConversationInfo);
      setRenderInput(initialInput.trim());
    } catch (requestError) {
      setError(`无法连接创作服务：${(requestError as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [initialInput]);

  const requestRender = useCallback(async (): Promise<void> => {
    if (!conversation || renderInput.trim().length === 0) {
      setError('请输入这次要交给模型绘制的描述。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postJson(
        `/api/v1/conversations/${conversation.conversation_id}/renders`,
        {
          message: renderInput.trim(),
          preferred_arm_model: armModel,
        },
      );
      if (!result.ok) {
        const problem = result.data as { code?: string; detail?: string } | null;
        setError(
          problem?.code === 'SKIN_ATTEMPTS_EXHAUSTED'
            ? '三次真实渲染机会已经用完。'
            : (problem?.detail ?? `请求生成失败（${result.status}）`),
        );
        return;
      }
      const accepted = result.data as { job_id: string };
      setRenders((previous) => [
        ...previous,
        { jobId: accepted.job_id, status: 'queued', candidateId: null, errorCode: null, armModel },
      ]);
      void pollJob(accepted.job_id, (status, candidateId, renderErrorCode) => {
        setRenders((previous) =>
          previous.map((entry) =>
            entry.jobId === accepted.job_id
              ? { ...entry, status, candidateId, errorCode: renderErrorCode }
              : entry,
          ),
        );
        if (status === 'succeeded' && candidateId) {
          setSelectedCandidateId(candidateId);
          void loadPreview(candidateId);
        }
      });
    } catch (requestError) {
      setError(`无法提交生成任务：${(requestError as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [conversation, renderInput, armModel, pollJob, loadPreview]);

  const finalize = useCallback(
    async (candidateId: string): Promise<void> => {
      if (!conversation || title.trim().length === 0) {
        setError('请先为最终皮肤填写标题。');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await postJson(
          `/api/v1/conversations/${conversation.conversation_id}/finalize`,
          { candidate_id: candidateId, title: title.trim(), description: description.trim() },
        );
        if (!result.ok) {
          const problem = result.data as { detail?: string } | null;
          setError(problem?.detail ?? `确认成品失败（${result.status}）`);
          return;
        }
        const accepted = result.data as { job_id: string };
        setFinalizeJobId(accepted.job_id);
        setFinalizeStatus('queued');
        void pollJob(accepted.job_id, (status, _candidateId, finalizeErrorCode) => {
          setFinalizeStatus(status);
          if (status === 'failed') setError(errorMessage(finalizeErrorCode));
        });
      } catch (requestError) {
        setError(`无法提交确认任务：${(requestError as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [conversation, title, description, pollJob],
  );

  const candidates = useMemo(
    () =>
      renders
        .map((entry, index) => ({
          candidateId: entry.candidateId,
          armModel: entry.armModel,
          attempt: index + 1,
        }))
        .filter(
          (entry): entry is { candidateId: string; armModel: 'steve' | 'alex'; attempt: number } =>
            entry.candidateId !== null,
        ),
    [renders],
  );
  const selectedCandidate =
    candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ??
    candidates.at(-1) ??
    null;
  const selectedPreviewBytes = selectedCandidate
    ? previewBytes[selectedCandidate.candidateId]
    : undefined;
  const currentStep =
    finalizeStatus === 'succeeded' ? 4 : candidates.length > 0 ? 3 : conversation ? 2 : 1;
  const attemptCount = Math.max(conversation?.attempts_used ?? 0, renders.length);

  return (
    <section className="studio-workflow" aria-label="AI 皮肤创作工作台">
      <WorkflowRail current={currentStep} />

      {!conversation ? (
        <div className="creation-grid creation-grid-empty">
          <article className="prompt-card panel">
            <div className="section-heading">
              <span className="section-kicker">01 / DEFINE YOUR SKIN</span>
              <h3>先给角色一个清晰的灵魂</h3>
              <p>写下主题、颜色、材质和标志性细节。描述越具体，逐像素蓝图越有辨识度。</p>
            </div>

            <div className={`provider-notice provider-notice-${providerMode}`}>
              <span className="notice-icon" aria-hidden="true">
                {providerMode === 'real' ? '✦' : '◇'}
              </span>
              <div>
                <strong>
                  {providerMode === 'real' ? '真实模型生成已启用' : '当前是固定样例演示'}
                </strong>
                <p>
                  {providerMode === 'real'
                    ? '提交后会调用已配置的远程模型，为这段描述重新设计像素蓝图。'
                    : '这里不会产生新皮肤；每种手臂模型只返回固定测试素材。请用 pnpm start:real 启动真实流程。'}
                </p>
              </div>
            </div>

            <label className="prompt-field">
              <span>
                <b>角色描述</b>
                <small>{initialInput.length} / 4000</small>
              </span>
              <textarea
                aria-label="皮肤描述"
                value={initialInput}
                onChange={(event) => setInitialInput(event.target.value)}
                placeholder="例如：来自深海遗迹的少年观测员，墨蓝短发，旧铜潜水服，袖口有发光水母纹样……"
                rows={7}
                maxLength={4000}
              />
            </label>

            <div className="prompt-starters">
              <span>灵感起点</span>
              <div>
                {PROMPT_STARTERS.map((prompt, index) => (
                  <button key={prompt} type="button" onClick={() => setInitialInput(prompt)}>
                    <b>0{index + 1}</b>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="alert alert-error" role="alert">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}
            <div className="primary-action-row">
              <div>
                <strong>下一步：建立创作会话</strong>
                <small>会话最多包含 3 次实际渲染</small>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => void startConversation()}
              >
                {busy ? (
                  <>
                    <i className="button-spinner" />
                    正在连接
                  </>
                ) : (
                  <>
                    开始创作 <span>→</span>
                  </>
                )}
              </button>
            </div>
          </article>

          <aside className="concept-canvas panel" aria-label="创作流程示意">
            <div className="canvas-grid" />
            <div className="blueprint-figure" aria-hidden="true">
              <i className="blueprint-head" />
              <i className="blueprint-body" />
              <i className="blueprint-arm blueprint-arm-left" />
              <i className="blueprint-arm blueprint-arm-right" />
              <i className="blueprint-leg blueprint-leg-left" />
              <i className="blueprint-leg blueprint-leg-right" />
              <span className="blueprint-scan" />
            </div>
            <div className="canvas-label canvas-label-top">
              <b>64²</b>
              <span>UV CANVAS</span>
            </div>
            <div className="canvas-label canvas-label-side">
              <b>3D</b>
              <span>LIVE RIG</span>
            </div>
            <div className="canvas-caption">
              <span>FROM LANGUAGE</span>
              <strong>TO PIXEL BLUEPRINT</strong>
              <p>自然语言 → 逐像素设计 → 结构校验 → 动态检查</p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="workbench-grid">
          <aside className="workbench-sidebar">
            <section className="session-card panel">
              <div className="session-title">
                <span className="live-pulse" />
                <div>
                  <small>ACTIVE SESSION</small>
                  <strong>创作会话</strong>
                </div>
                <code>{conversation.conversation_id.slice(0, 8)}</code>
              </div>
              <div className="session-metrics" data-testid="conversation-state">
                <div>
                  <b>
                    {attemptCount}/{conversation.attempts_limit}
                  </b>
                  <span>状态：{conversation.status} · 已用渲染</span>
                </div>
                <div>
                  <b>{conversation.attempts_limit - attemptCount}</b>
                  <span>剩余机会</span>
                </div>
                <div>
                  <b>{formatExpiry(conversation.expires_at)}</b>
                  <span>自动清理</span>
                </div>
              </div>
            </section>

            <section className="editor-card panel">
              <div className="compact-heading">
                <span>02</span>
                <div>
                  <small>GENERATION BRIEF</small>
                  <h3>编辑生成指令</h3>
                </div>
              </div>
              <label className="prompt-field compact">
                <span>
                  <b>本次描述</b>
                  <small>{renderInput.length} / 4000</small>
                </span>
                <textarea
                  aria-label="渲染描述"
                  value={renderInput}
                  onChange={(event) => setRenderInput(event.target.value)}
                  rows={6}
                  maxLength={4000}
                />
              </label>
              <fieldset className="model-selector">
                <legend>手臂模型</legend>
                <button
                  type="button"
                  className={armModel === 'steve' ? 'is-selected' : ''}
                  aria-pressed={armModel === 'steve'}
                  onClick={() => setArmModel('steve')}
                >
                  <span className="arm-icon arm-wide" aria-hidden="true" />
                  <span>
                    <strong>Steve</strong>
                    <small>经典 4px 手臂</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={armModel === 'alex' ? 'is-selected' : ''}
                  aria-pressed={armModel === 'alex'}
                  onClick={() => setArmModel('alex')}
                >
                  <span className="arm-icon arm-slim" aria-hidden="true" />
                  <span>
                    <strong>Alex</strong>
                    <small>纤细 3px 手臂</small>
                  </span>
                </button>
              </fieldset>
              <button
                className="primary-button render-button"
                type="button"
                disabled={busy || renders.length >= conversation.attempts_limit}
                onClick={() => void requestRender()}
              >
                {busy ? (
                  <>
                    <i className="button-spinner" />
                    正在提交
                  </>
                ) : (
                  <>
                    <span>✦</span>请求真实渲染
                  </>
                )}
              </button>
              <p className="field-footnote">
                {providerMode === 'real'
                  ? '每次点击都会调用远程模型并消耗一次渲染机会。'
                  : '演示模式只验证流程，不会根据描述生成新内容。'}
              </p>
            </section>

            <section className="render-queue panel">
              <div className="queue-heading">
                <div>
                  <small>RENDER QUEUE</small>
                  <h3>生成记录</h3>
                </div>
                <span>
                  {renders.length} / {conversation.attempts_limit}
                </span>
              </div>
              {renders.length === 0 ? (
                <div className="queue-empty">
                  <span>+</span>
                  <p>
                    还没有生成任务
                    <br />
                    <small>完善描述后发起第一次渲染</small>
                  </p>
                </div>
              ) : (
                <ol data-testid="render-list">
                  {renders.map((entry, index) => (
                    <li
                      key={entry.jobId}
                      data-testid={`render-${index}`}
                      className={`render-${entry.status}`}
                    >
                      <span className="render-index">0{index + 1}</span>
                      <div>
                        <strong>{STATUS_LABELS[entry.status]}</strong>
                        <small>
                          {entry.armModel.toUpperCase()} ·{' '}
                          {entry.candidateId
                            ? entry.candidateId.slice(0, 8)
                            : entry.jobId.slice(0, 8)}
                        </small>
                      </div>
                      <i aria-hidden="true" />
                      {entry.errorCode && <p>{errorMessage(entry.errorCode)}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {error && (
              <div className="alert alert-error" role="alert">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}
          </aside>

          <section className="preview-workspace panel">
            <header className="workspace-heading">
              <div>
                <span className="section-kicker">03 / INSPECT & REFINE</span>
                <h3>候选检查台</h3>
              </div>
              <div className={`workspace-mode provider-${providerMode}`}>
                <span />
                {providerMode === 'real' ? 'REAL GENERATION' : 'FIXTURE DEMO'}
              </div>
            </header>

            {selectedCandidate ? (
              <>
                <ul data-testid="candidate-list" className="candidate-list" aria-label="候选切换">
                  {candidates.map((candidate) => (
                    <li key={candidate.candidateId}>
                      <button
                        type="button"
                        className={
                          candidate.candidateId === selectedCandidate.candidateId ? 'is-active' : ''
                        }
                        onClick={() => setSelectedCandidateId(candidate.candidateId)}
                      >
                        <span>候选 0{candidate.attempt}</span>
                        <small>{candidate.candidateId.slice(0, 8)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="candidate-item">
                  {selectedPreviewBytes ? (
                    <SkinPreview
                      bytes={selectedPreviewBytes}
                      armModel={selectedCandidate.armModel}
                      scale={7}
                    />
                  ) : (
                    <div className="preview-loading">
                      <i />
                      <strong>正在装配 3D 预览</strong>
                      <span>读取已验证的 64×64 候选……</span>
                    </div>
                  )}
                </div>

                <div className="finalize-panel">
                  <div className="compact-heading">
                    <span>04</span>
                    <div>
                      <small>FINALIZE CANDIDATE</small>
                      <h3>为这件作品命名</h3>
                    </div>
                  </div>
                  <div className="finalize-fields">
                    <label>
                      <span>作品标题</span>
                      <input
                        aria-label="成品标题"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={120}
                        placeholder="例如：深海遗迹观测员"
                      />
                    </label>
                    <label>
                      <span>补充说明</span>
                      <input
                        aria-label="成品描述"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        maxLength={4000}
                        placeholder="可选：记录灵感、配色或使用场景"
                      />
                    </label>
                  </div>
                  <div className="finalize-action">
                    <p>
                      <strong>确认后会再次执行结构校验</strong>
                      <span>最终下载等待公共契约补全；当前先完成 Standalone 定稿。</span>
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      data-testid={`confirm-${selectedCandidate.candidateId.slice(0, 8)}`}
                      disabled={busy || finalizeJobId !== null}
                      onClick={() => void finalize(selectedCandidate.candidateId)}
                    >
                      确认这个候选 <span>→</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div
                className={`empty-workspace${renders.some((entry) => entry.status === 'queued' || entry.status === 'running') ? ' is-rendering' : ''}`}
              >
                <div className="empty-rig" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <span />
                </div>
                <div>
                  <span className="empty-number">03</span>
                  <h3>{renders.length > 0 ? '模型正在逐像素绘制' : '候选会在这里醒来'}</h3>
                  <p>
                    {renders.length > 0
                      ? '完成构图、UV 映射和双层校验后，3D 角色会自动出现在检查台。'
                      : '在左侧提交描述。有效候选生成后，你可以旋转角色、播放动作并检查每一个面。'}
                  </p>
                </div>
              </div>
            )}

            {finalizeJobId && (
              <div className={`finalize-status finalize-${finalizeStatus ?? 'queued'}`}>
                <span aria-hidden="true">{finalizeStatus === 'succeeded' ? '✓' : '↻'}</span>
                <div>
                  <strong data-testid="finalize-status">
                    确认任务：{finalizeStatus ? STATUS_LABELS[finalizeStatus] : '等待处理'}
                  </strong>
                  {finalizeStatus === 'succeeded' && (
                    <p data-testid="finalize-done">成品已在 Standalone 模式完成确认。</p>
                  )}
                  {finalizeStatus === 'failed' && <p>最终校验失败，请检查错误后重试。</p>}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
