export function ThemeInit() {
  const script = `
    (function() {
      try {
        var t = localStorage.getItem('aae_theme');
        if (!t) {
          t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  `
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
