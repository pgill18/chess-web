'use strict';
// Arena (Phase 4): named AI cast roster, train-vs-rival, and tournaments — in-browser. Reuses the
// same lib/ primitives as the CLI (chooseMoveAs, the character registry, roundRobinSteps/
// knockoutSteps). A full tournament can take MINUTES (quiescence characters cost ~2-3s/move), so
// tournaments run OFF the main thread in a Web Worker (engine-worker.js, task #95 / Skyline Phase
// 0): the worker runs the whole RR→KO sequence and streams step messages back, so the tab stays
// fully responsive throughout (verified by faye's live pass — real clicks instant across a ~6.5min
// 4-rival run) and the log updates live. Determinism is unchanged: the worker runs the same lib
// generators with the same seed, so a seed replays byte-identical whether run in the worker, the
// in-thread fallback, or the CLI (verified byte-identical webapp-worker vs CLI at seed 424242).
// When Worker is unavailable (very old browser) runTournament falls back to driving the same
// generators in-thread via setTimeout(0) — that path DOES block the tab, but still completes
// correctly; both paths share one formatter so their output can't diverge.
//
// (Note: the single-game rival play below still searches on the main thread — one ~2-3s move at a
// time, same as the Play view, which was never the freeze; off-threading it would need serializing
// mulberry32 state across postMessage, deliberately deferred.)
(function () {
  let root, g, rng, voiceRng, seed, char, charKey, selected, over, tournamentCancelled, activeWorker;

  function start(container) { root = container; showSetup(); }

  // One completed-game / bye result line, formatted identically whether the step arrived from the
  // in-thread generator (fallback) or streamed from the worker — one formatter, no divergence.
  function stepLine(step) {
    if (step.bye) return '  ' + step.bye + ' advances on a bye';
    return (step.round ? 'R' + step.round + ' ' : '') + step.white + ' vs ' + step.black + ': ' + step.result
      + (step.winner ? ' -> ' + step.winner + ' advances' : '') + '  (' + step.plies + ' plies)';
  }

  // Terminate any tournament worker still running (leaving the view / starting a new run) so a
  // long search can't outlive the UI that spawned it.
  function stopWorker() { if (activeWorker) { activeWorker.terminate(); activeWorker = null; } }

  function showSetup() {
    stopWorker();
    const L = window.Lib;
    const cast = L.listCharacters();
    root.innerHTML = '<div class="arena-setup">'
      + '<h2>Arena &middot; Train vs Rival</h2>'
      + '<div class="cast-roster">' + cast.map((c) => '<div class="cast-card" data-key="' + c.key + '">'
        + '<h3>' + c.name + '</h3><p>' + c.blurb + '</p></div>').join('') + '</div>'
      + '<label>Color <select id="a-color"><option value="w" selected>White</option><option value="b">Black</option><option value="random">Random</option></select></label>'
      + '<label>Seed <input type="number" id="a-seed" value="' + ((Date.now() & 0x7fffffff) || 1) + '" /></label>'
      + '<div id="a-record"></div>'
      + '<hr /><h2>Tournament</h2>'
      + '<p>Round robin (everyone plays everyone once) then a knockout seeded by the standings. Games run in the background, so '
      + '<strong>the page stays responsive</strong> and the log updates live as they play out — a full tournament can still take several minutes (longer with more rivals), but you can keep using the app while it runs.</p>'
      + '<div class="cast-checks">' + cast.map((c) => '<label><input type="checkbox" class="t-pick" value="' + c.key + '" checked /> ' + c.name + '</label>').join(' ') + '</div>'
      + '<label>Tournament seed <input type="number" id="t-seed" value="' + ((Date.now() & 0x7fffffff) || 1) + '" /></label>'
      + '<button id="t-run">Run tournament</button>'
      + '<pre id="t-log" class="tournament-log"></pre>'
      + '</div>';
    let pickedKey = cast[0] ? cast[0].key : null;
    root.querySelectorAll('.cast-card').forEach((card) => {
      card.addEventListener('click', () => {
        root.querySelectorAll('.cast-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        pickedKey = card.dataset.key;
        // Let the .is-selected sigil->brass CSS transition paint before we tear down this DOM
        // for the board (leo/esme's Arena sign-off blocker) — pure presentational timing, no
        // logic/seed/flow change; pickedKey is captured above, before the timeout.
        setTimeout(() => startGame(pickedKey), 220);
      });
    });
    document.getElementById('t-run').addEventListener('click', () => {
      const picks = Array.from(root.querySelectorAll('.t-pick:checked')).map((cb) => cb.value);
      const tseed = parseInt(document.getElementById('t-seed').value, 10) || 1;
      const runBtn = document.getElementById('t-run');
      const logEl = document.getElementById('t-log');
      if (picks.length < 2) { logEl.textContent = 'Pick at least 2 characters.'; return; }
      // Paint a visible "starting" state immediately on click (and disable the button in the same
      // paint so a double-click can't launch a second overlapping run), deferred one tick so the
      // browser repaints before runTournament kicks off the worker.
      runBtn.disabled = true;
      logEl.textContent = 'Starting… games run in the background — the page stays responsive and the log updates live. This can take a few minutes.';
      setTimeout(() => runTournament(picks, tseed, runBtn), 0);
    });
  }

  // Drives a generator (roundRobinSteps/knockoutSteps) one step at a time, yielding to the
  // browser's render/input loop via setTimeout(0) between steps. Steps now come after EVERY
  // MOVE ('ply' events), not just after each game — onProgress fires (and repaints) on those
  // without spamming the log; onStep only fires for completed games, and onDone at the very end.
  function driveGenerator(gen, onProgress, onStep, onDone) {
    if (tournamentCancelled) return;
    let result;
    try { result = gen.next(); } catch (e) { onStep('Error: ' + e.message); return; }
    if (result.done) return;
    const step = result.value;
    if (step.type === 'done') { onDone(step); return; }
    if (step.type === 'ply') onProgress(step);
    else onStep(stepLine(step)); // one shared formatter (stepLine handles bye + game) — genuinely no divergence with the worker path now (otis #95 nit)
    setTimeout(() => driveGenerator(gen, onProgress, onStep, onDone), 0);
  }

  function runTournament(participants, tseed, runBtn) {
    const L = window.Lib;
    tournamentCancelled = false;
    stopWorker();
    const logEl = document.getElementById('t-log');
    const lines = ['Round robin (seed ' + tseed + '): ' + participants.join(', '), ''];
    let statusLine = '';
    function render() { logEl.textContent = lines.join('\n') + (statusLine ? '\n' + statusLine : ''); logEl.scrollTop = logEl.scrollHeight; }
    function append(line) { lines.push(line); statusLine = ''; render(); }
    // Fires after every move (playGameSteps yields per ply) — updates a single trailing status
    // line in place rather than appending, so the log shows real-time progress within a game
    // (the thing ada found never appeared before) without flooding it with 60+ lines per game.
    function progress(step) {
      statusLine = (step.round ? 'R' + step.round + ' ' : '') + step.white + ' vs ' + step.black
        + (step.tiebreak ? ' (tiebreak)' : '') + ': move ' + step.plies + '…';
      render();
    }
    function showStandings(standings) {
      append('');
      append('Standings:');
      standings.forEach((s, i) => append('  ' + (i + 1) + '. ' + s.key + '  ' + s.points + 'pt  (' + s.wins + 'W-' + s.losses + 'L-' + s.draws + 'D)'));
      append('');
      append('Knockout (seeded): ' + standings.map((s) => s.key).join(' > '));
    }
    function finish(champion) { append(''); append('Champion: ' + champion); if (runBtn) runBtn.disabled = false; activeWorker = null; }

    // Preferred path (#95): run the whole tournament in a Web Worker so the UI thread never
    // blocks — the tab stays fully interactive throughout, not just between plies. The worker
    // streams the same step objects the generators yield; we render them exactly as the in-thread
    // path would. Falls back to the in-thread generator drive below when Workers aren't available
    // (e.g. an ancient browser) or the manifest wasn't exposed — same output, just a blocked tab.
    if (typeof Worker !== 'undefined' && window.LIB_MANIFEST) {
      let worker;
      try { worker = new Worker('engine-worker.js?v=' + window.LIB_MANIFEST.version); }
      catch (e) { worker = null; }
      if (worker) {
        activeWorker = worker;
        worker.onmessage = (e) => {
          if (tournamentCancelled) return;
          const m = e.data;
          if (m.type === 'step') { if (m.step.type === 'ply') progress(m.step); else append(stepLine(m.step)); }
          else if (m.type === 'rr-done') showStandings(m.standings);
          else if (m.type === 'done') { finish(m.champion); stopWorker(); }
          else if (m.type === 'error') { append('Error: ' + m.message); if (runBtn) runBtn.disabled = false; stopWorker(); }
        };
        worker.onerror = (e) => { append('Error: ' + (e.message || 'worker failed')); if (runBtn) runBtn.disabled = false; stopWorker(); };
        worker.postMessage({ manifest: window.LIB_MANIFEST, job: 'tournament', args: { participants, seed: tseed } });
        return;
      }
    }

    // Fallback: drive the generators on the main thread (blocks the tab, but always completes).
    const rrGen = L.roundRobinSteps(participants, tseed);
    driveGenerator(rrGen, progress, append, (rrDone) => {
      showStandings(rrDone.standings);
      const koGen = L.knockoutSteps(rrDone.standings.map((s) => s.key), tseed);
      driveGenerator(koGen, progress, append, (koDone) => finish(koDone.champion));
    });
  }

  function startGame(key) {
    const L = window.Lib;
    char = L.getCharacter(key);
    charKey = key;
    const color = document.getElementById('a-color').value;
    seed = parseInt(document.getElementById('a-seed').value, 10) || 1;
    const human = color === 'random' ? (L.makeRng(seed).int(2) === 0 ? 'w' : 'b') : color;
    rng = L.makeRng(seed);
    // Separate rng stream for voice-line flavor (mirrors cli/play.js's voiceRng exactly) — the
    // move rng must never be touched by anything that isn't a move decision, or Seed stops
    // reproducing the game (otis's #74 finding).
    voiceRng = L.makeRng((seed ^ 0x2545f491) >>> 0);
    g = new L.Chess();
    over = false; selected = null;
    window.__arenaHuman = human; // read by render/onSquare below
    render('"' + char.voiceLines[0] + '"');
    if (human === 'b') { render('AI is thinking…'); setTimeout(aiMove, 150); }
  }

  function moveListHtml() {
    const h = g.history();
    let out = '';
    for (let i = 0; i < h.length; i += 2) out += '<li>' + h[i] + (h[i + 1] ? ' ' + h[i + 1] : '') + '</li>';
    return out;
  }

  function render(msg) {
    const human = window.__arenaHuman;
    const s = g.status();
    root.innerHTML = '<div class="play-wrap"><div id="board-host"></div><aside class="play-side">'
      + '<h3>vs ' + char.name + '</h3>'
      + '<div class="status">' + s.text + '</div>'
      + '<div id="msg">' + (msg || '') + '</div>'
      + '<button id="a-back">Choose a different rival</button>'
      + '<ol class="movelist">' + moveListHtml() + '</ol></aside></div>';
    window.BoardView.render(document.getElementById('board-host'), g, { orient: human, selected, onSquare });
    document.getElementById('a-back').addEventListener('click', showSetup);
  }

  function isOwn(p) { const human = window.__arenaHuman; return human === 'w' ? (p >= 'A' && p <= 'Z') : (p >= 'a' && p <= 'z'); }

  function onSquare(sq) {
    const human = window.__arenaHuman;
    if (over || g.turn() !== human) return;
    const piece = g.get(sq);
    if (selected) {
      const opts = g.moves({ square: selected, verbose: true });
      const mv = opts.find((m) => m.to === sq);
      if (mv) { doHumanMove({ from: selected, to: sq, promotion: mv.promotion ? 'q' : undefined }); return; }
      if (piece && isOwn(piece)) { selected = sq; render(); return; }
      const from = selected; selected = null;
      try { g.move({ from, to: sq }); render(); return; } catch (e) { render(e.message); return; }
    }
    if (piece && isOwn(piece)) { selected = sq; render(); }
  }

  function doHumanMove(input) {
    try { g.move(input); } catch (e) { render(e.message); return; }
    selected = null;
    if (g.isGameOver()) { render(); return endGame(); }
    render('AI is thinking…');
    setTimeout(aiMove, 150);
  }

  function aiMove() {
    const L = window.Lib;
    const m = L.chooseMoveAs(g.state, charKey, rng);
    if (m) g.move({ from: L.algebraic(m.from), to: L.algebraic(m.to), promotion: m.promotion });
    selected = null;
    let msg;
    if (voiceRng() < 0.35 && char.voiceLines.length) msg = '"' + char.voiceLines[voiceRng.int(char.voiceLines.length)] + '"';
    render(msg);
    if (g.isGameOver()) endGame();
  }

  function endGame() {
    over = true;
    render('Game over — ' + g.status().text + ' (train-vs-rival record tracking is CLI-only for now, see `play rival` / `gym A`)');
  }

  window.ArenaView = { start };
})();
