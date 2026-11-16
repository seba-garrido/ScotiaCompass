(() => {
  const key = 'scotia-compass-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Private browser mode. */ }
  if (!['light', 'dark'].includes(preference)) preference = null;
  function apply() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14151b' : '#ec111a');
    document.dispatchEvent(new CustomEvent('scotia-theme-change', { detail: theme }));
  }
  window.scotiaTheme = {
    get: () => document.documentElement.dataset.theme,
    set(theme) {
      if (!['light', 'dark'].includes(theme)) return;
      preference = theme;
      try { localStorage.setItem(key, theme); } catch { /* Keep the preference for this page. */ }
      apply();
    }
  };
  system.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    apply();
  });
  apply();
})();
