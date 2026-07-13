'use strict';
// Settings > Gamification — generated FROM the module registry (lib/gamification's
// listModules()), not hand-built per module. Same "don't hand-build per module" principle as
// the CLI's `gym settings` screen.
(function () {
  function render(root) {
    const L = window.Lib;
    const settings = window.Storage.loadGamification();
    const modules = L.listModules();
    let html = '<div class="settings-view"><h2>Settings &middot; Gamification</h2>'
      + '<p>Every feature below is a toggleable module — turning one off only silences its display, it never touches your Chess Mastery %.</p>'
      + '<div class="module-list">';
    modules.forEach((m) => {
      const on = L.isModuleEnabled(settings, m.id);
      html += '<div class="module-row" data-id="' + m.id + '">'
        + '<label class="module-toggle"><input type="checkbox" data-id="' + m.id + '"' + (on ? ' checked' : '') + ' />'
        + '<span class="module-name">' + m.name + '</span></label>'
        + '<p class="module-desc">' + m.description + '</p>'
        + '</div>';
    });
    html += '</div></div>';
    root.innerHTML = html;
    root.querySelectorAll('input[type="checkbox"][data-id]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        L.setModuleEnabled(settings, e.target.dataset.id, e.target.checked);
        window.Storage.saveGamification(settings);
      });
    });
  }
  window.SettingsView = { render };
})();
