'use strict';
// Top-level view routing. Started by the bootstrap once lib/ has loaded.
(function () {
  function start() {
    const loading = document.getElementById('loading');
    if (loading) loading.remove();
    document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
    // First-run onboarding: intake is required at Level 2 (spec §2), offered once, skippable.
    if (!window.Storage.loadIntake()) show('intake');
    else show('map');
  }
  function show(view) {
    document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const root = document.getElementById('app');
    if (view === 'play') window.PlayView.start(root);
    else if (view === 'intake') {
      window.IntakeView.start(root, (result) => {
        // A skip (result === null) still marks intake "offered" so it doesn't re-prompt every load.
        window.Storage.saveIntake(result || { skipped: true, at: new Date().toISOString() });
        show('map');
      });
    } else {
      window.MapView.render(root, (stationId) => window.StationView.render(root, stationId, () => show('map')));
    }
  }
  window.App = { start, show };
})();
