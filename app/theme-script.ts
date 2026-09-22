// This script prevents theme flash on page load
// It must run before React hydration
if (typeof window !== 'undefined') {
  const savedTheme = localStorage.getItem('ilitda-theme') || 'system';
  
  let theme = savedTheme;
  
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  
  document.documentElement.classList.add(theme);
}
