import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, extractErrorMessage } from '@/lib/api';
import { cardClass, inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import type { PublicContributionSession } from '@/types';

function formatTimeLeft(expiresAt: number | null) {
  if (!expiresAt) return '';
  const remain = Math.max(0, Math.ceil(expiresAt * 1000 - Date.now()) / 1000);
  const mins = Math.floor(remain / 60);
  const secs = Math.floor(remain % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function StatusTimeline({ currentStatus }: { currentStatus: string }) {
  const steps = [
    { key: 'created', label: '发起共享登录', done: true, active: false },
    { key: 'waiting_for_login', label: '完成账号授权', done: currentStatus !== 'waiting_for_login', active: currentStatus === 'waiting_for_login' },
    { key: 'pending_review', label: '等待管理员审核', done: false, active: currentStatus === 'pending_review' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <div key={step.key} className="relative rounded-xl border border-gray-200 bg-white/80 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/40">
          {index < steps.length - 1 ? (
            <div className="absolute top-6 left-[calc(100%-0.5rem)] hidden h-px w-6 bg-gray-200 dark:bg-slate-700 sm:block" />
          ) : null}
          <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
            step.done
              ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
              : step.active
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
          >
            {step.done ? '✓' : index + 1}
          </div>
          <div className="mt-3 text-sm font-medium text-gray-900 dark:text-slate-100">{step.label}</div>
          <div className={`mt-1 text-xs ${
            step.done
              ? 'text-green-700 dark:text-green-400'
              : step.active
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-gray-500 dark:text-slate-400'
          }`}
          >
            {step.done ? '已完成' : step.active ? '当前阶段' : '待开始'}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ContributeAccountPage() {
  const [inviteCode, setInviteCode] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [applicantContact, setApplicantContact] = useState('');
  const [note, setNote] = useState('');
  const [requestedMaxConcurrency, setRequestedMaxConcurrency] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState<PublicContributionSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startPolling = (contributionId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const res = await api<PublicContributionSession>('GET', `/api/public/contributions/${contributionId}`);
        if (res.ok) {
          setSession(res.data);
          if (!['waiting_for_login'].includes(res.data.status)) {
            if (timerRef.current) clearInterval(timerRef.current);
          }
        }
      } catch {
        // Silently ignore polling errors — will retry on next interval
      }
    }, 2000);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<PublicContributionSession>('POST', '/api/public/contributions/start', {
        inviteCode: inviteCode.trim(),
        applicantName: applicantName.trim(),
        applicantContact: applicantContact.trim(),
        note: note.trim(),
        requestedMaxConcurrency: Number(requestedMaxConcurrency || '1'),
      });
      if (!res.ok) {
        setError(extractErrorMessage(res.data, '发起共享登录失败'));
        return;
      }
      setSession(res.data);
      startPolling(res.data.contributionId);
    } catch {
      setError('网络请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    if (!session) return;
    try {
      await api('POST', `/api/public/contributions/${session.contributionId}/cancel`);
    } catch {
      // Ignore cancel errors
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setSession(null);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12">
      <div className={`${cardClass} p-6`}>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">共享账号登录</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
          使用邀请码发起共享登录。登录成功后账号不会直接入池，会进入管理员审核队列。
        </p>

        {!session ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <input className={inputClass} placeholder="邀请码" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <input className={inputClass} placeholder="你的称呼" value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
            <input className={inputClass} placeholder="联系方式" value={applicantContact} onChange={(e) => setApplicantContact(e.target.value)} />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
                建议并发名额
              </label>
              <input
                className={inputClass}
                type="number"
                min="1"
                placeholder="例如 1 或 2"
                value={requestedMaxConcurrency}
                onChange={(e) => setRequestedMaxConcurrency(e.target.value)}
              />
              <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">
                表示你建议这个账号可同时处理多少个请求。数值越高，代表愿意共享的使用容量越大；管理员会根据实际情况审核确认。
              </p>
            </div>
            <textarea className={inputClass} placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <button type="submit" disabled={loading} className={primaryBtnClass}>
              {loading ? '创建中...' : '开始登录'}
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            {session.status === 'pending_review' ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 via-emerald-50 to-white p-6 shadow-sm dark:border-green-900/60 dark:from-green-950/40 dark:via-emerald-950/30 dark:to-slate-900">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-2xl text-green-700 dark:bg-green-900/50 dark:text-green-300">
                        ✓
                      </div>
                      <div>
                        <div className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          等待审核
                        </div>
                        <h2 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-slate-100">登录已完成</h2>
                        <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600 dark:text-slate-300">
                          你的共享账号申请已经提交，当前正在等待管理员审核入池。审核期间无需停留在本页面，稍后可根据管理员通知查看结果。
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-white/80 px-4 py-3 text-left shadow-sm ring-1 ring-green-100 dark:bg-slate-900/50 dark:ring-green-900/50">
                      <div className="text-xs text-gray-500 dark:text-slate-400">申请编号</div>
                      <div className="mt-1 font-mono text-sm text-gray-900 dark:text-slate-100">{session.contributionId}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-5 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">当前进度</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                      你的登录授权已经完成，流程已进入管理员审核阶段。
                    </p>
                  </div>
                  <StatusTimeline currentStatus={session.status} />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">接下来会发生什么</h3>
                    <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600 dark:text-slate-300">
                      <p>审核通过后，账号会加入共享池并按管理员确认的并发度生效。</p>
                      <p>如果审核被拒绝，管理员可以附带审核备注，说明原因。</p>
                      <p>审核期间无需保持页面开启，你提供的联系方式将作为后续沟通依据。</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">本次提交信息</h3>
                    <div className="mt-3 space-y-3 text-sm">
                      <div>
                        <div className="text-xs text-gray-500 dark:text-slate-400">状态</div>
                        <div className="mt-1 font-medium text-gray-900 dark:text-slate-100">等待管理员审核</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 dark:text-slate-400">建议并发名额</div>
                        <div className="mt-1 font-medium text-gray-900 dark:text-slate-100">{requestedMaxConcurrency}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {session.error ? <p className="text-sm text-red-600 dark:text-red-400">{session.error}</p> : null}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link to="/" className={primaryBtnClass}>完成</Link>
                  <Link to="/support" className={secondaryBtnClass}>查看入池说明</Link>
                  <button type="button" onClick={cancel} className={secondaryBtnClass}>撤销本次提交</button>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  撤销后，本次共享登录记录会被关闭；如需重新加入，需要再次发起共享登录。
                </p>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-800">
                  <div className="text-xs text-gray-500 dark:text-slate-400">状态</div>
                  <div className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{session.status}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-800">
                  <div className="text-xs text-gray-500 dark:text-slate-400">登录链接</div>
                  <a className="mt-1 block break-all text-sm text-brand-600 dark:text-brand-400" href={session.loginUrl ?? '#'} target="_blank" rel="noreferrer">
                    {session.loginUrl ?? '等待生成'}
                  </a>
                </div>
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-800">
                  <div className="text-xs text-gray-500 dark:text-slate-400">设备验证码</div>
                  <div className="mt-1 font-mono text-lg tracking-widest text-gray-900 dark:text-slate-100">{session.deviceCode ?? '等待生成'}</div>
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  剩余时间：{formatTimeLeft(session.expiresAt)}
                </p>
                {session.error ? <p className="text-sm text-red-600 dark:text-red-400">{session.error}</p> : null}
                <div className="flex gap-2">
                  <button type="button" onClick={cancel} className={secondaryBtnClass}>取消</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
