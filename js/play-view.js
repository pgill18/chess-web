'use strict';
// Play a full game vs the seeded AI, or hotseat (two players, no AI), in-browser. A FEN input
// lets a specific position (ep-pin, castling-through-check, etc.) be constructed directly in
// the UI for edge-case testing — the webapp's equivalent of the CLI's forgiving --fen/--seed
// flags. All rules/AI come from lib/ verbatim.
(function () {
  let g, level, rng, seed, selected, human, over, container, hints, takebacks, mode;

  // Public entry point (called by app.js) — always starts at the setup screen.
  function start(root) { showSetup(root); }

  function showSetup(root) {
    container = root;
    const L = window.Lib;
    root.innerHTML = '<div class="play-setup">'
      + '<h2>Play</h2>'
      + '<div class="mode-choice">'
      + '<label><input type="radio" name="mode" value="ai" checked /> vs AI</label> '
      + '<label><input type="radio" name="mode" value="hotseat" /> Hotseat (two players)</label>'
      + '</div>'
      + '<div id="ai-opts">'
      + '<label>AI Level <select id="s-level">' + [1, 2, 3, 4, 5].map((l) => '<option value="' + l + '"' + (l === 2 ? ' selected' : '') + '>L' + l + '</option>').join('') + '</select></label>'
      + '<label>Your color <select id="s-color"><option value="w" selected>White</option><option value="b">Black</option><option value="random">Random</option></select></label>'
      + '<label>Seed <input type="number" id="s-seed" value="' + ((Date.now() & 0x7fffffff) || 1) + '" /></label>'
      + '</div>'
      + '<label>Start FEN (optional — for constructing a specific test position)<br />'
      + '<input type="text" id="s-fen" placeholder="' + L.START_FEN + '" style="width:100%" /></label>'
      + '<div id="s-error" class="error"></div>'
      + '<button id="s-start">Start</button>'
      + '</div>';
    document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', (e) => {
      document.getElementById('ai-opts').style.display = e.target.value === 'hotseat' ? 'none' : '';
    }));
    document.getElementById('s-start').addEventListener('click', () => {
      const modeVal = document.querySelector('input[name="mode"]:checked').value;
      const fenVal = document.getElementById('s-fen').value.trim();
      if (fenVal) { try { L.fromFEN(fenVal); } catch (e) { document.getElementById('s-error').textContent = 'Invalid FEN: ' + e.message; return; } }
      const opts = { mode: modeVal, fen: fenVal || null };
      if (modeVal === 'ai') {
        opts.level = parseInt(document.getElementById('s-level').value, 10);
        opts.color = document.getElementById('s-color').value;
        opts.seed = parseInt(document.getElementById('s-seed').value, 10) || 1;
      }
      startGame(root, opts);
    });
  }

  function startGame(root, opts) {
    container = root;
    const L = window.Lib;
    mode = opts.mode || 'ai';
    g = opts.fen ? new L.Chess(opts.fen) : new L.Chess();
    over = false; selected = null; hints = 0; takebacks = 0;
    if (mode === 'ai') {
      seed = opts.seed || 1;
      rng = L.makeRng(seed);
      // A fresh, separately-seeded rng instance for the color pick (mirrors cli/play.js) — it
      // doesn't consume from `rng`, so the AI's move sequence is unaffected by the color choice.
      human = opts.color === 'random' ? (L.makeRng(seed).int(2) === 0 ? 'w' : 'b') : (opts.color || 'w');
      level = opts.level || 2;
    } else {
      human = null; // hotseat: whoever's turn it is, is "human" — no fixed side
    }
    render();
    if (mode === 'ai' && human !== g.turn()) { render('AI is thinking…'); setTimeout(aiMove, 150); }
  }

  function moveListHtml() {
    const h = g.history();
    let out = '';
    for (let i = 0; i < h.length; i += 2) out += '<li>' + h[i] + (h[i + 1] ? ' ' + h[i + 1] : '') + '</li>';
    return out;
  }

  function render(msg) {
    const s = g.status();
    const orient = mode === 'hotseat' ? g.turn() : human;
    container.innerHTML =
      '<div class="play-wrap">'
      + '<div id="board-host"></div>'
      + '<aside class="play-side">'
      + '<div class="status">' + s.text + '</div>'
      + '<div class="controls">'
      + (mode === 'ai' ? '<label>AI Level <select id="level">' + [1, 2, 3, 4, 5].map((l) => '<option value="' + l + '"' + (l === level ? ' selected' : '') + '>L' + l + '</option>').join('') + '</select></label>' : '')
      + '<button id="newgame">New game</button>'
      + (mode === 'ai' ? '<button id="hintbtn">Hint</button><button id="undo">Takeback</button>' : '')
      + '</div>'
      + '<div id="msg">' + (msg || (mode === 'ai' ? ('Seed ' + seed + ' · you are ' + (human === 'w' ? 'White' : 'Black')) : 'Hotseat · two players')) + '</div>'
      + '<ol class="movelist">' + moveListHtml() + '</ol>'
      + '</aside></div>';
    window.BoardView.render(document.getElementById('board-host'), g, { orient, selected, onSquare });
    if (mode === 'ai') {
      document.getElementById('level').addEventListener('change', (e) => { level = parseInt(e.target.value, 10); });
      document.getElementById('hintbtn').addEventListener('click', hint);
      document.getElementById('undo').addEventListener('click', undo);
    }
    document.getElementById('newgame').addEventListener('click', () => showSetup(container));
  }

  function onSquare(sq) {
    if (over) return;
    if (mode === 'ai' && g.turn() !== human) return;
    const piece = g.get(sq);
    if (selected) {
      const opts = g.moves({ square: selected, verbose: true });
      const mv = opts.find((m) => m.to === sq); // auto-queen: engine defaults promotion to q via {from,to}
      if (mv) { doHumanMove({ from: selected, to: sq, promotion: mv.promotion ? 'q' : undefined }); return; }
      // Reselect silently if clicking another own piece (that's a normal UI action, not an attempt).
      if (piece && isOwn(piece)) { selected = sq; render(); return; }
      // Otherwise this was a real illegal-move attempt — surface the engine's teaching
      // explanation (the same text the CLI gives) instead of silently deselecting.
      const from = selected; selected = null;
      try { g.move({ from, to: sq }); render(); return; } catch (e) { render(e.message); return; }
    }
    if (piece && isOwn(piece)) { selected = sq; render(); }
  }

  function isOwn(p) {
    const side = mode === 'hotseat' ? g.turn() : human;
    return side === 'w' ? (p >= 'A' && p <= 'Z') : (p >= 'a' && p <= 'z');
  }

  function doHumanMove(input) {
    try { g.move(input); } catch (e) { render(e.message); return; }
    selected = null;
    if (g.isGameOver()) { render(); return endGame(); }
    if (mode === 'ai') { render('AI is thinking…'); setTimeout(aiMove, 150); }
    else render();
  }

  function aiMove() {
    const L = window.Lib;
    const m = L.chooseMove(g.state, level, rng);
    if (m) g.move({ from: L.algebraic(m.from), to: L.algebraic(m.to), promotion: m.promotion });
    selected = null;
    render();
    if (g.isGameOver()) endGame();
  }

  function hint() {
    if (over || mode !== 'ai' || g.turn() !== human) return;
    const L = window.Lib;
    const hr = L.makeRng((seed ^ 0x9e3779b9) >>> 0);
    const m = L.chooseMove(g.state, Math.max(level, 3), hr);
    hints++;
    if (m) { selected = L.algebraic(m.from); render('Hint: consider ' + L.algebraic(m.from) + '→' + L.algebraic(m.to) + ' (recorded)'); }
  }

  function undo() {
    // Takeback is offered versus the AI only (mirrors cli/play.js: "Takeback is only offered versus the AI").
    if (over || mode !== 'ai') return;
    if (g.turn() === human && g.history().length >= 2) { g.undo(); g.undo(); takebacks++; }
    else if (g.history().length >= 1) { g.undo(); takebacks++; }
    selected = null;
    render('Takeback (recorded)');
  }

  function endGame() {
    over = true;
    const L = window.Lib;
    const fens = g.history({ verbose: true }).map((h) => h.before).slice(1).concat([g.fen()]);
    const blunders = L.analyzeGame(fens);
    const lines = ['Game over — ' + g.status().text,
      'Hanging-piece blunders — White: ' + blunders.w + ', Black: ' + blunders.b];
    // Mastery Map feed is AI-only (mirrors cli/play.js: hotseat never loads/saves a profile —
    // there's no single "the player" side to award, and it keeps parity between hosts honest).
    if (mode === 'ai') {
      const state = window.Storage.load();
      const out = L.mastery.postGameHook(state, {
        events: {
          result: g.result(), playerColor: human, aiLevel: level, mode: 'ai',
          byCheckmate: g.isCheckmate(), blunders: blunders[human],
          naturalEnd: g.isCheckmate() || g.isDraw(), plies: g.history().length,
          drawByRuleClaimed: g.isDraw(), nowISO: new Date().toISOString(),
        },
      });
      window.Storage.save(state);
      if (out && out.lines) lines.push(...out.lines);
      document.getElementById('overall').textContent = 'Chess Mastery ' + L.mastery.overallPercent(state) + '%';
    } else {
      lines.push('Recommended station + Arena milestones: available in a saved profile via play vs AI.');
    }
    render(lines.join('<br>'));
  }

  window.PlayView = { start };
})();
