/** Display initial only; identity, accessible names and color hashing keep the full name. */
export function avatarInitial(name: string): string {
  let display = name.trim();
  const suffix = /\s*[（(][^（）()]*[）)]\s*$/u;
  while (suffix.test(display)) display = display.replace(suffix, '');
  if (!display) return Array.from(name).find(character => !/[()（）\s]/u.test(character)) ?? '—';
  return /^[A-Za-z]/u.test(display) ? display.charAt(0).toUpperCase() : Array.from(display).at(-1) ?? '—';
}
