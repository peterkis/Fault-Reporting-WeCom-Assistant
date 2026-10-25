// Keep this entry free of dependencies: production emits it as a classic script.
(() => {
  const ua = navigator.userAgent;
  const theme = /ColorScheme\/Dark/i.test(ua) ? 'dark'
    : /ColorScheme\/Light/i.test(ua) ? 'light'
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const language = /Language\/([\w-]+)/i.exec(ua)?.[1] ?? navigator.language;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.lang = /^zh(?:[-_]|$)/i.test(language) ? 'zh-CN' : 'en';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#12141a' : '#faf9f8');
})();
