import type { ApiKey } from '@/types';

/** 自助申领 Key 的申请人信息展示（桌面和移动复用） */
export function SelfServiceBadge() {
  return (
    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
      自助申领
    </span>
  );
}

export function KeyApplicantInfo({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.source !== 'self_service') return null;

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-slate-400">
        {apiKey.applicantName && (
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
            </svg>
            {apiKey.applicantName}
          </span>
        )}
        {apiKey.applicantContact && (
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
            </svg>
            {apiKey.applicantContact}
          </span>
        )}
        {apiKey.templateName && (
          <span className="inline-flex items-center gap-1">
            <svg className="h-3 w-3 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            {apiKey.templateName}
          </span>
        )}
      </div>
      {apiKey.applicantNote && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500 italic truncate max-w-xs" title={apiKey.applicantNote}>
          备注: {apiKey.applicantNote}
        </p>
      )}
    </div>
  );
}
