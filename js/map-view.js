'use strict';
// The Mastery Map — the visual centerpiece. Graphical wings + stations with % bars & crests.
(function () {
  // onOpen(stationId) is called when a station card is clicked/tapped — the map's only job is
  // to route there; Learn/Drill/Prove/test-out lives in StationView.
  function render(root, onOpen) {
    const L = window.Lib;
    const M = L.mastery;
    const state = window.Storage.load();
    // Gated on the refresherNudge module (Settings > Gamification) — a different UI shape than
    // the CLI's one text line (this drives a per-station visual light-state), but the same
    // underlying toggle: when off, stations never show the "refresher" visual state.
    const gset = window.Storage.loadGamification();
    const refresherOn = L.isModuleEnabled(gset, 'refresherNudge');
    let html = '<div class="map">';
    for (const w of Object.keys(M.WING_WEIGHTS)) {
      const pct = M.wingPercent(state, w);
      const hasCrest = M.hasCrest(state, w);
      const crest = '<span class="crest' + (hasCrest ? ' is-earned' : '') + '" title="Wing crest' + (hasCrest ? ' earned' : '') + '">✶</span>';
      html += '<section class="wing" data-wing="' + w + '" style="--pct:' + pct + '">'
        + '<h2><span class="wcode">' + w + '</span> ' + M.WINGS[w].name + ' ' + crest + '<em>' + pct + '%</em></h2>'
        + '<div class="wingbar"><div class="fill" style="width:' + pct + '%"></div></div>'
        + '<div class="stations">';
      for (const s of M.wingStations(w)) {
        const sp = M.stationPercent(state, s.id);
        const stStore = state.stations[s.id];
        const proved = !!(stStore && stStore.proved);
        const refresher = refresherOn && M.refresherDue(state, s.id, new Date().toISOString());
        // data-state for the design layer's light metaphor — no lock state (prereqs are soft, spec: never locked).
        // refresher must be checked BEFORE proved: refresherDue() only ever fires for an
        // already-proved station, so if proved were checked first, 'refresher' would be
        // unreachable dead code (faye's #75 finding, filed as #77).
        const dataState = refresher ? 'refresher' : proved ? 'mastered' : sp > 0 ? 'lit' : 'unlit';
        html += '<div class="station' + (proved ? ' is-mastered' : '') + '" data-state="' + dataState + '" data-station="' + s.id + '" style="--pct:' + sp + '" role="button" tabindex="0" title="Open ' + s.id + ' — Learn / Drill / Prove">'
          + '<div class="srow"><span class="sid">' + s.id + '</span><span class="sname">' + s.name + '</span><span class="spct">' + sp + '%</span></div>'
          + '<div class="sbar"><div class="sfill" style="width:' + sp + '%"></div></div>'
          + '</div>';
      }
      html += '</div></section>';
    }
    html += '</div>';
    root.innerHTML = html;
    const overall = M.overallPercent(state);
    document.getElementById('overall').textContent = 'Chess Mastery ' + overall + '%';
    if (onOpen) {
      root.querySelectorAll('[data-station]').forEach((el) => {
        const open = () => onOpen(el.dataset.station);
        el.addEventListener('click', open);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
    }
  }
  window.MapView = { render };
})();
