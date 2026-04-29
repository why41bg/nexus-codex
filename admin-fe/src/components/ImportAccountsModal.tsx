import { useState, useCallback, useRef, useId, useEffect } from 'react';
import { api, extractErrorMessage } from '@/lib/api';
import { inputClass, primaryBtnClass, secondaryBtnClass } from '@/lib/styles';
import { useToast } from '@/contexts/ToastContext';
import { useAuthGuard } from '@/contexts/AuthContext';
import { useFocusTrap } from '@/lib/use-focus-trap';
import Spinner from './Spinner';

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
  const authGuard = useAuthGuard();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(dialogRef);

  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [inputMethod, setInputMethod] = useState<'file' | 'text'>('file');
  const [textInput, setTextInput] = useState('');
  const [parsed, setParsed] = useState<ValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const parseAndValidate = useCallback((raw: string): ValidationResult => {
    const result: ValidationResult = { valid: [], errors: [] };
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      result.errors.push({ index: -1, message: 'JSON \u683c\u5f0f\u9519\u8bef\uff0c\u8bf7\u68c0\u67e5\u8f93\u5165\u5185\u5bb9' });
      return result;
    }

    let items: unknown[];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object' && 'accounts' in data && Array.isArray((data as { accounts: unknown[] }).accounts)) {
      items = (data as { accounts: unknown[] }).accounts;
    } else {
      result.errors.push({ index: -1, message: '\u6570\u636e\u683c\u5f0f\u65e0\u6548\uff0c\u9700\u8981 JSON \u6570\u7ec4\u6216 { accounts: [...] } \u683c\u5f0f' });
      return result;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object') {
        result.errors.push({ index: i, message: '\u4e0d\u662f\u6709\u6548\u7684\u5bf9\u8c61' });
        continue;
      }
      const codexHome = typeof item.codexHome === 'string' ? item.codexHome.trim() : '';
      if (!codexHome) {
        result.errors.push({ index: i, message: 'codexHome \u4e0d\u80fd\u4e3a\u7a7a' });
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
      toast('\u8bf7\u4e0a\u4f20 .json \u6587\u4ef6', 'error');
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

  const doImport = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setImporting(true);
    try {
      const res = await api<{ imported: number; skipped: number; errors: Array<{ index: number; message: string }> }>(
        'POST',
        '/api/admin/accounts/import',
        { accounts: parsed.valid, mode },
      );
      if (authGuard(res.status)) return;
      if (res.ok) {
        const d = res.data;
        const parts: string[] = [`\u6210\u529f\u5bfc\u5165 ${d.imported} \u4e2a\u8d26\u53f7`];
        if (d.skipped > 0) parts.push(`\u8df3\u8fc7 ${d.skipped} \u4e2a\u91cd\u590d`);
        if (d.errors.length > 0) parts.push(`${d.errors.length} \u4e2a\u5931\u8d25`);
        toast(parts.join('\uff0c'), d.errors.length > 0 ? 'error' : 'success');
        onImported();
      } else {
        toast(extractErrorMessage(res.data, '\u5bfc\u5165\u5931\u8d25'), 'error');
      }
    } catch {
      toast('\u8bf7\u6c42\u5931\u8d25', 'error');
    } finally {
      setImporting(false);
    }
  };

  const validCount = parsed?.valid.length ?? 0;
  const errorCount = parsed?.errors.length ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="mx-4 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-xl ring-1 ring-gray-200 dark:ring-slate-700 outline-none"
      >
        <h3 id={titleId} className="text-base font-semibold text-gray-900 dark:text-slate-100">\u5bfc\u5165\u8d26\u53f7</h3>

        {/* \u5bfc\u5165\u6a21\u5f0f */}
        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-gray-600 dark:text-slate-400">\u5bfc\u5165\u6a21\u5f0f</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
                className="mt-0.5 accent-brand-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800 dark:text-slate-200">\u5408\u5e76\u5bfc\u5165</span>
                <p className="text-xs text-gray-500 dark:text-slate-400">\u4fdd\u7559\u73b0\u6709\u8d26\u53f7\uff0c\u4ec5\u8ffd\u52a0\u65b0\u8d26\u53f7\uff08\u6309 codexHome \u53bb\u91cd\uff09</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
                className="mt-0.5 accent-brand-600"
              />
              <div>
                <span className="text-sm font-medium text-red-700 dark:text-red-400">\u66ff\u6362\u5bfc\u5165</span>
                <p className="text-xs text-gray-500 dark:text-slate-400">\u6e05\u7a7a\u73b0\u6709\u6240\u6709\u8d26\u53f7\u540e\u5bfc\u5165\uff08\u5371\u9669\u64cd\u4f5c\uff09</p>
              </div>
            </label>
          </div>
        </fieldset>

        {/* \u8f93\u5165\u65b9\u5f0f\u5207\u6362 */}
        <div className="mt-4 flex gap-1 border-b border-gray-200 dark:border-slate-700">
          <button
            onClick={() => setInputMethod('file')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${inputMethod === 'file' ? 'border-b-2 border-brand-600 text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'}`}
          >
            \u6587\u4ef6\u4e0a\u4f20
          </button>
          <button
            onClick={() => setInputMethod('text')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${inputMethod === 'text' ? 'border-b-2 border-brand-600 text-brand-600 dark:text-brand-400' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'}`}
          >
            \u6587\u672c\u7c98\u8d34
          </button>
        </div>

        {/* \u6587\u4ef6\u4e0a\u4f20 */}
        {inputMethod === 'file' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 transition-colors ${
              dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-950' : 'border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
            }`}
          >
            <p className="text-sm text-gray-600 dark:text-slate-400">\u62d6\u62fd JSON \u6587\u4ef6\u5230\u6b64\u5904\uff0c\u6216\u70b9\u51fb\u9009\u62e9\u6587\u4ef6</p>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">\u652f\u6301 .json \u683c\u5f0f</p>
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

        {/* \u6587\u672c\u7c98\u8d34 */}
        {inputMethod === 'text' && (
          <div className="mt-3">
            <textarea
              value={textInput}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={`\u7c98\u8d34 JSON \u6570\u7ec4\uff0c\u4f8b\u5982\uff1a\n[\n  {\n    "codexHome": "/Users/you/.codex-pool/account-1",\n    "remark": "account-1@example.com",\n    "maxConcurrency": 3\n  }\n]`}
              rows={8}
              className={inputClass + ' font-mono text-xs'}
            />
          </div>
        )}

        {/* \u89e3\u6790\u7ed3\u679c\u9884\u89c8 */}
        {parsed && (
          <div className="mt-4">
            <div className="flex items-center gap-3 text-sm">
              {validCount > 0 && (
                <span className="text-green-600 dark:text-green-400">{validCount} \u6761\u6709\u6548</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-600 dark:text-red-400">{errorCount} \u6761\u6709\u9519\u8bef</span>
              )}
            </div>

            {validCount > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-slate-700">
                    <tr>
                      <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">codexHome</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">\u5907\u6ce8</th>
                      <th className="px-3 py-1.5 font-medium text-gray-500 dark:text-slate-400">\u5e76\u53d1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {parsed.valid.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-slate-300 truncate max-w-[200px]">{item.codexHome}</td>
                        <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400 truncate max-w-[120px]">{item.remark || '\u2014'}</td>
                        <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400">{item.maxConcurrency ?? '\u9ed8\u8ba4'}</td>
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
                    {err.index >= 0 ? `\u7b2c ${err.index + 1} \u6761\uff1a` : ''}{err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* \u66ff\u6362\u6a21\u5f0f\u8b66\u544a */}
        {mode === 'replace' && validCount > 0 && (
          <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">\u26a0 \u5371\u9669\u64cd\u4f5c</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              \u6b64\u64cd\u4f5c\u5c06\u5220\u9664\u6240\u6709\u73b0\u6709\u8d26\u53f7\u5e76\u7528\u5bfc\u5165\u6570\u636e\u66ff\u6362\uff0c\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\uff01
            </p>
          </div>
        )}

        {/* \u64cd\u4f5c\u6309\u94ae */}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className={secondaryBtnClass}>
            \u53d6\u6d88
          </button>
          <button
            onClick={doImport}
            disabled={validCount === 0 || importing}
            className={primaryBtnClass}
          >
            {importing && <Spinner className="mr-1.5 h-4 w-4" />}
            {validCount > 0 ? `\u786e\u8ba4\u5bfc\u5165 (${validCount} \u6761)` : '\u786e\u8ba4\u5bfc\u5165'}
          </button>
        </div>
      </div>
    </div>
  );
}
