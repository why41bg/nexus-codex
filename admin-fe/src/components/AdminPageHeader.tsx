import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export default function AdminPageHeader({ title, description, actions }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
