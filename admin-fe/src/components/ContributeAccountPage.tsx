import { useEffect, useRef, useState } from 'react';
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
      const res = await api<PublicContributionSession>('GET', `/api/public/contributions/${contributionId}`);
      if (res.ok) {
        setSession(res.data);
        if (!['waiting_for_login'].includes(res.data.status)) {
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    }, 2000);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await api<PublicContributionSession>('POST', '/api/public/contributions/start', {
      inviteCode: inviteCode.trim(),
      applicantName: applicantName.trim(),
      applicantContact: applicantContact.trim(),
      note: note.trim(),
      requestedMaxConcurrency: Number(requestedMaxConcurrency || '1'),
    });
    setLoading(false);
    if (!res.ok) {
      setError(extractErrorMessage(res.data, '发起共享登录失败'));
      return;
    }
    setSession(res.data);
    startPolling(res.data.contributionId);
  };

  const cancel = async () => {
    if (!session) return;
    await api('POST', `/api/public/contributions/${session.contributionId}/cancel`);
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
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="建议并发度"
              value={requestedMaxConcurrency}
              onChange={(e) => setRequestedMaxConcurrency(e.target.value)}
            />
            <textarea className={inputClass} placeholder="备注（可选）" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <button type="submit" disabled={loading} className={primaryBtnClass}>
              {loading ? '创建中...' : '开始登录'}
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
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
            {session.status === 'pending_review' ? (
              <p className="text-sm text-green-700 dark:text-green-400">登录已完成，等待管理员审核入池。</p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className={secondaryBtnClass}>取消</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
