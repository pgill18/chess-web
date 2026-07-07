'use strict';
// Intake assessment (required at Level 2, PRODUCT-SPEC §2). ~8 min: samples Prove-tier items
// across wings via lib/intake (pure), then shows a suggested entry point + "likely strong"
// stations. Grants NO % itself — Learn/Drill/Prove still earn the map afterward.
(function () {
  let items, i, answers, root, done;

  function start(container, onDone) {
    root = container; done = onDone;
    const L = window.Lib;
    items = L.buildIntakeSet((Date.now() & 0x7fffffff) || 1);
    i = 0; answers = [];
    intro();
  }

  function intro() {
    root.innerHTML =
      '<div class="intake-intro">'
      + '<h2>Quick intake (about 8 minutes)</h2>'
      + '<p>A handful of items across every wing so we can suggest where to start. '
      + 'This does not change your Chess Mastery % — Learn, Drill, and Prove still earn that, honestly.</p>'
      + '<button id="begin">Begin</button> <button id="skip">Skip for now</button>'
      + '</div>';
    document.getElementById('begin').addEventListener('click', ask);
    document.getElementById('skip').addEventListener('click', () => done(null));
  }

  function ask() {
    if (i >= items.length) return finish();
    const it = items[i];
    root.innerHTML =
      '<div class="intake-item">'
      + '<div class="intake-progress">Item ' + (i + 1) + ' / ' + items.length + '</div>'
      + '<div id="board-host"></div>'
      + '<div class="intake-controls">'
      + '<input id="ans" type="text" placeholder="Your move (SAN or e2e4)" autocomplete="off" />'
      + '<button id="submit">Submit</button>'
      + '</div></div>';
    const g = new window.Lib.Chess(it.fen);
    let selected = null;
    function renderBoard() { window.BoardView.render(document.getElementById('board-host'), g, { selected, onSquare }); }
    function onSquare(sq) {
      const piece = g.get(sq);
      const isOwn = piece && piece === piece.toUpperCase();
      if (selected) {
        const opts = g.moves({ square: selected, verbose: true });
        const mv = opts.find((m) => m.to === sq);
        if (mv) { document.getElementById('ans').value = mv.san; selected = null; renderBoard(); return; }
        selected = isOwn ? sq : null; renderBoard(); return;
      }
      if (isOwn) { selected = sq; renderBoard(); }
    }
    renderBoard();
    const submit = () => {
      const raw = document.getElementById('ans').value;
      let correct = false;
      try {
        if (it.kind === 'rule' && it.ruleType === 'move-piece') correct = window.Lib.raw.puzzle.gradeMovePiece(it.fen, raw, it.pieceType).ok;
        else if (it.kind === 'strategy') correct = window.Lib.raw.puzzle.gradeStrategy(it.fen, raw, {}).ok;
        else correct = raw.replace(/[+#]$/, '').trim() === it.solution[0].replace(/[+#]$/, '');
      } catch (e) { correct = false; }
      answers.push({ id: it.id, correct });
      i++; ask();
    };
    document.getElementById('submit').addEventListener('click', submit);
    document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  function finish() {
    const result = window.Lib.scoreIntake(items, answers);
    root.innerHTML = '<div class="intake-done"><h2>Intake complete</h2><p>' + result.text + '</p>'
      + '<button id="continue">Go to the Map</button></div>';
    document.getElementById('continue').addEventListener('click', () => done(result));
  }

  window.IntakeView = { start };
})();
