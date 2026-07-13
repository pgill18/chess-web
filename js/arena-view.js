'use strict';
// Arena (Phase 4): named AI cast roster, train-vs-rival, and tournaments — in-browser. Reuses the
// same lib/ primitives as the CLI (chooseMoveAs, the character registry, roundRobinSteps/
// knockoutSteps). A full tournament can take MINUTES (quiescence characters cost ~2-3s/move) —
// running it as one giant synchronous call would freeze the tab, so the generator steps are
// driven with a setTimeout(0) between games. Honest caveat: this yields BETWEEN games, so the UI
// repaints and can be cancelled between them — a single game's own multi-second computation still
// blocks briefly while it runs. That's a real, meaningful improvement over one multi-minute
// freeze, not a claim of perfect responsiveness throughout.
(function () {
  let root, g, rng, voiceRng, seed, char, charKey, selected, over, tournamentCancelled;

  function start(container) { root = container; showSetup(); }

  function showSetup() {
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
      + '<p>Round robin (everyone plays everyone once) then a knockout seeded by the standings. Games can take a while — a progress log appears below once you start.</p>'
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
      if (picks.length < 2) { document.getElementById('t-log').textContent = 'Pick at least 2 characters.'; return; }
      runTournament(picks, tseed);
    });
  }

  // Drives a generator (roundRobinSteps/knockoutSteps) one game at a time, yielding to the
  // browser's render/input loop via setTimeout(0) between games rather than blocking straight
  // through — see the file header note on what this does and doesn't guarantee.
  function driveGenerator(gen, onStep, onDone) {
    if (tournamentCancelled) return;
    let result;
    try { result = gen.next(); } catch (e) { onStep('Error: ' + e.message); return; }
    if (result.done) return;
    const step = result.value;
    if (step.type === 'done') { onDone(step); return; }
    if (step.bye) onStep('  ' + step.bye + ' advances on a bye');
    else onStep((step.round ? 'R' + step.round + ' ' : '') + step.white + ' vs ' + step.black + ': ' + step.result
      + (step.winner ? ' -> ' + step.winner + ' advances' : '') + '  (' + step.plies + ' plies)');
    setTimeout(() => driveGenerator(gen, onStep, onDone), 0);
  }

  function runTournament(participants, tseed) {
    const L = window.Lib;
    tournamentCancelled = false;
    const logEl = document.getElementById('t-log');
    const lines = ['Round robin (seed ' + tseed + '): ' + participants.join(', '), ''];
    function append(line) { lines.push(line); logEl.textContent = lines.join('\n'); logEl.scrollTop = logEl.scrollHeight; }
    const rrGen = L.roundRobinSteps(participants, tseed);
    driveGenerator(rrGen, append, (rrDone) => {
      append('');
      append('Standings:');
      rrDone.standings.forEach((s, i) => append('  ' + (i + 1) + '. ' + s.key + '  ' + s.points + 'pt  (' + s.wins + 'W-' + s.losses + 'L-' + s.draws + 'D)'));
      const seeded = rrDone.standings.map((s) => s.key);
      append('');
      append('Knockout (seeded): ' + seeded.join(' > '));
      const koGen = L.knockoutSteps(seeded, tseed);
      driveGenerator(koGen, append, (koDone) => {
        append('');
        append('Champion: ' + koDone.champion);
      });
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
