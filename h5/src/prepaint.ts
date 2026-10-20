import { applyTheme, clientLanguage, clientTheme } from './lib/preferences';
applyTheme(clientTheme(navigator.userAgent, window.matchMedia('(prefers-color-scheme: dark)').matches));
document.documentElement.lang = clientLanguage(navigator.userAgent, navigator.language);
