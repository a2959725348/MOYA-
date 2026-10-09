export type Theme = 'dark' | 'light'

export function readTheme(): Theme {
  try { return localStorage.getItem('workbench-theme') === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#09090b' : '#f4f4f5')
  try { localStorage.setItem('workbench-theme', theme) } catch { /* Theme switching also works with unavailable storage. */ }
}

export function initializeTheme(): Theme {
  const theme = readTheme()
  applyTheme(theme)
  return theme
}
