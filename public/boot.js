// Apply a saved paper colour before first paint (no inline scripts under the CSP).
try {
  var t = window.localStorage.getItem('knot-theme');
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* storage blocked: follow the system setting */
}
