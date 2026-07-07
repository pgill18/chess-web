'use strict';
// Play a full game vs the seeded AI in-browser. All rules/AI come from lib/ verbatim.
(function () {
  let g, level, rng, seed, selected, human, over, container, hints, takebacks;

  function start(root) {
    container = root;
    const L = window.Lib;
    g = new L.Chess();
    human = 'w'; level = 2; over = false; selected = null; hints = 0; takebacks = 0;
    seed = (Date.now() & 0x7fffffff) || 1; // browser Date is fine here (not the engine)
    rng = L.makeRng(seed);
    render();
  }

  function moveListHtml() {
    const h = g.history();
    let out = '';
    for (let i = 0; i < h.length; i += 2) out += '<li>' + h[i] + (h[i + 1] ? ' ' + h[i + 1] : '') + '</li>';
    return out;
  }

  function render(msg) {
    const s = g.status();
    container.innerHTML =
      '<div class="play-wrap">'
      + '<div id="board-host"></div>'
      + '<aside class="play-side">'
      + '<div class="status">' + s.text + '</div>'
      + '<div class="controls">'
      + '<label>AI Level <select id="level">' + [1, 2, 3, 4, 5].map((l) => '<option value="' + l + '"' + (l === level ? ' selected' : '') + '>L' + l + '</option>').join('') + '</select></label>'
      + '<button id="newgame">New game</button>'
      + '<button id="hintbtn">Hint</button>'
      + '<button id="undo">Takeback</button>'
      + '</div>'
      + '<div id="msg">' + (msg || ('Seed ' + seed + ' · you are White')) + '</div>'
      + '<ol class="movelist">' + moveListHtml() + '</ol>'
      + '</aside></div>';
    window.BoardView.render(document.getElementById('board-host'), g, { orient: human, selected, onSquare });
    document.getElementById('level').addEventListener('change', (e) => { level = parseInt(e.target.value, 10); });
    document.getElementById('newgame').addEventListener('click', () => start(container));
    document.getElementById('hintbtn').addEventListener('click', hint);
    document.getElementById('undo').addEventListener('click', undo);
  }

  function onSquare(sq) {
    if (over || g.turn() !== human) return;
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

  function isOwn(p) { return human === 'w' ? (p >= 'A' && p <= 'Z') : (p >= 'a' && p <= 'z'); }

  function doHumanMove(input) {
    try { g.move(input); } catch (e) { render(e.message); return; }
    selected = null;
    if (g.isGameOver()) { render(); return endGame(); }
    render('AI is thinking…');
    setTimeout(aiMove, 150);
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
    if (over || g.turn() !== human) return;
    const L = window.Lib;
    const hr = L.makeRng((seed ^ 0x9e3779b9) >>> 0);
    const m = L.chooseMove(g.state, Math.max(level, 3), hr);
    hints++;
    if (m) { selected = L.algebraic(m.from); render('Hint: consider ' + L.algebraic(m.from) + '→' + L.algebraic(m.to) + ' (recorded)'); }
  }

  function undo() {
    if (over) return;
    // take back the AI reply + your move so it's your turn again
    if (g.turn() === human && g.history().length >= 2) { g.undo(); g.undo(); takebacks++; }
    else if (g.history().length >= 1) { g.undo(); takebacks++; }
    selected = null;
    render('Takeback (recorded)');
  }

  function endGame() {
    over = true;
    const L = window.Lib;
    const state = window.Storage.load();
    const fens = g.history({ verbose: true }).map((h) => h.before).slice(1).concat([g.fen()]);
    const blunders = L.analyzeGame(fens);
    const result = g.result();
    const out = L.mastery.postGameHook(state, {
      events: {
        result, playerColor: human, aiLevel: level, mode: 'ai',
        byCheckmate: g.isCheckmate(), blunders: blunders[human],
        naturalEnd: g.isCheckmate() || g.isDraw(), plies: g.history().length,
        drawByRuleClaimed: g.isDraw(), nowISO: new Date().toISOString(),
      },
    });
    window.Storage.save(state);
    const lines = ['Game over — ' + g.status().text,
      'Hanging-piece blunders — White: ' + blunders.w + ', Black: ' + blunders.b].concat((out && out.lines) || []);
    render(lines.join('<br>'));
    document.getElementById('overall').textContent = 'Chess Mastery ' + L.mastery.overallPercent(state) + '%';
  }

  window.PlayView = { start };
})();
