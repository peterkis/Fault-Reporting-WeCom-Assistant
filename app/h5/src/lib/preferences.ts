export type Language = 'zh-CN' | 'en';
export type Theme = 'light' | 'dark';
export function clientLanguage(userAgent: string, browserLanguage: string): Language {
  const language = /Language\/([\w-]+)/i.exec(userAgent)?.[1] ?? browserLanguage;
  return /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en';
}
export function clientTheme(userAgent: string, prefersDark: boolean): Theme {
  if (/ColorScheme\/Dark/i.test(userAgent)) return 'dark';
  if (/ColorScheme\/Light/i.test(userAgent)) return 'light';
  return prefersDark ? 'dark' : 'light';
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#12141a' : '#faf9f8');
}
export function followClientPreferences(onLanguage: (language: Language) => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => { if (import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === '1') return; applyTheme(clientTheme(navigator.userAgent, media.matches)); onLanguage(clientLanguage(navigator.userAgent, navigator.language)); };
  const visible = () => {if (document.visibilityState === 'visible') update();};
  update(); media.addEventListener('change', update); document.addEventListener('visibilitychange', visible);
  return () => {media.removeEventListener('change', update); document.removeEventListener('visibilitychange', visible);};
}
