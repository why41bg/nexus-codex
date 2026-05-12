import { useState, useCallback, useRef } from 'react';
import { inputClass, primaryBtnClass, secondaryBtnClass, filterTabBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useImportAccounts } from '@/hooks/useAdminMutations';
import Spinner from './Spinner';
import BaseModal from './BaseModal';

interface ImportAccount {
  codexHome: string;
  remark?: string;
  maxConcurrency?: number;
  enabled?: boolean;
}

interface ValidationResult {
  valid: ImportAccount[];
  errors: Array<{ index: number; message: string }>;
}

interface Props {
  onImported: () => void;
  onCancel: () => void;
}

export default function ImportAccountsModal({ onImported, onCancel }: Props) {
  const { toast } = useToast();
  const importMutation = useImportAccounts();

  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [inputMethod, setInputMethod] = useState<'file' | 'text'>('file');
  const [textInput, setTextInput] = useState('');
  const [parsed, setParsed] = useState<ValidationResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseAndValidate = useCallback((raw: string): ValidationResult => {
    const result: ValidationResult = { valid: [], errors: [] };
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      result.errors.push({ index: -1, message: 'JSON 格式错误，请检查输入内容' });
      return result;
    }

    let items: unknown[];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object' && 'accounts' in data && Array.isArray((data as { accounts: unknown[] }).accounts)) {
      items = (data as { accounts: unknown[] }).accounts;
    } else {
      result.errors.push({ index: -1, message: '数据格式无效，需要 JSON 数组或 { accounts: [...] } 格式' });
      return result;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        result.errors.push({ index: i, message: '不是有效的对象' });
        continue;
      }
      const codexHome = typeof item.codexHome === 'string' ? item.codexHome.trim() : '';
      if (!codexHome) {
        result.errors.push({ index: i, message: 'codexHome 不能为空' });
        continue;
      }
      const acc: ImportAccount = { codexHome };
      if (typeof item.remark === 'string') acc.remark = item.remark;
      if (typeof item.maxConcurrency === 'number' && item.maxConcurrency >= 1) {
        acc.maxConcurrency = item.maxConcurrency;
      }
      if (typeof item.enabled === 'boolean') acc.enabled = item.enabled;
      result.valid.push(acc);
    }
    return result;
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setTextInput(text);
      setParsed(parseAndValidate(text));
    };
    reader.readAsText(file);
  }, [parseAndValidate]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      handleFileSelect(file);
    } else {
      toast('请上传 .json 文件', 'error');
    }
  }, [handleFileSelect, toast]);

  const handleTextChange = useCallback((value: string) => {
    setTextInput(value);
    if (value.trim()) {
      setParsed(parseAndValidate(value));
    } else {
      setParsed(null);
    }
  }, [parseAndValidate]);

  const doImport = () => {
    if (!parsed || parsed.valid.length === 0) return;
    importMutation.mutate(
      { accounts: parsed.valid, mode },
      { onSuccess: () => onImported() },
    );
  };

  const validCount = parsed?.valid.length ?? 0;
  const errorCount = parsed?.errors.length ?? 0;

  return (
    <BaseModal title="导入账号" maxWidth="max-w-lg" onClose={onCancel}>
      <fieldset>
        <legend className="text-xs font-medium text-gray-600 dark:text-slate-400">导入模式</legend>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="importMode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
              className="mt-0.5 accent-brand-600"
            />
            <div>
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">合并导入</span>
              <p className="text-xs text-gray-500 dark:text-slate-400">保留现有账号，仅追加新账号（按 codexHome 去重）</p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="importMode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              className="mt-0.5 accent-brand-600"
            />
            <div>
              <span className="text-sm font-medium text-red-700 dark:text-red-400">替换导入</span>
              <p className="text-xs text-gray-500 dark:text-slate-400">清空现有所有账号后导入（危险操作）</p>
            </div>
          </label>
        </div>
      </fieldset>

      <div className="mt-4 flex gap-1 border-b border-gray-200 dark:border-slate-700">
        <button type="button" onClick={() => setInputMethod('file')} className={filterTabBtnClass(inputMethod === 'file')}>
          文件上传
        </button>
        <button type="button" onClick={() => setInputMethod('text')} className={filterTabBtnClass(inputMethod === 'text')}>
          文本粘贴
        </button>
      </div>

      {inputMethod === 'file' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${
            dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
          }`}
        >
          <p className="text-sm text-gray-600 dark:text-slate-400">拖拽 JSON 文件到此处，或点击选择文件</p>
          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">支持 .json 格式</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </div>
      )}

      {inputMethod === 'text' && (
        <div className="mt-3">
          <textarea
            value={textInput}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={`粘贴 JSON 数组，例如：\n[\n  {\n    "codexHome": "/Users/you/.codex-pool/account-1",\n    "remark": "account-1@example.com",\n    "maxConcurrency": 3\n  }\n]`}
            rows={8}
            className={inputClass + ' font-mono text-xs'}
          />
        </div>
      )}

      {parsed && (
        <div className="mt-4">
          <div className="flex items-center gap-3 text-sm">
            {validCount > 0 && <span className="text-green-600 dark:text-green-400">{validCount} 条有效</span>}
            {errorCount > 0 && <span className="text-red-600 dark:text-red-400">{errorCount} 条有错误</span>}
          </div>

          {validCount > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-slate-700">
                  <tr>
                    <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">codexHome</th>
                    <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">备注</th>
                    <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">并发</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {parsed.valid.map((item, i) => (
                    <tr key={i}>
                      <td className="max-w-[200px] truncate px-3 py-1.5 font-mono text-gray-700 dark:text-slate-300">{item.codexHome}</td>
                      <td className="max-w-[120px] truncate px-3 py-1.5 text-gray-500 dark:text-slate-400">{item.remark || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400">{item.maxConcurrency ?? '默认'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {errorCount > 0 && (
            <div className="mt-2 space-y-1">
              {parsed.errors.map((err, i) => (
                <div key={i} className="text-xs text-red-600 dark:text-red-400">
                  {err.index >= 0 ? `第 ${err.index + 1} 条：` : ''}
                  {err.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'replace' && validCount > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">⚠ 危险操作</p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            此操作将删除所有现有账号并用导入数据替换，此操作不可撤销！
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className={secondaryBtnClass}>
          取消
        </button>
        <button type="button" onClick={doImport} disabled={validCount === 0 || importMutation.isPending} className={primaryBtnClass}>
          {importMutation.isPending && <Spinner className="mr-1.5 h-4 w-4" />}
          {validCount > 0 ? `确认导入 (${validCount} 条)` : '确认导入'}
        </button>
      </div>
    </BaseModal>
  );
}
