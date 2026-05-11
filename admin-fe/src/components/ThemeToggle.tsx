import { useTheme } from '@/contexts/ThemeContext';

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const modeOrder: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
  const modeIcons = { system: '💻', light: '☀️', dark: '🌙' };

  const cycleMode = () => {
    const idx = modeOrder.indexOf(mode);
    setMode(modeOrder[(idx + 1) % modeOrder.length]);
  };

  return (
    <button
      onClick={cycleMode}
      className="absolute top-6 right-6 flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
      title={`当前主题：${mode}`}
    >
      <span className="text-lg">{modeIcons[mode]}</span>
    </button>
  );
}
