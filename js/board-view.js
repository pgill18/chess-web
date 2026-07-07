'use strict';
// Click/tap board with legal-move highlights. Pure view over a lib/ Chess instance — no rules
// here; legality comes from game.moves(). Renders into `container`; calls opts.onSquare(alg).
(function () {
  const FILES = 'abcdefgh';
  const GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  function glyph(p) { return '<span class="pc ' + (p === p.toUpperCase() ? 'w' : 'b') + '">' + GLYPH[p] + '</span>'; }

  function render(container, game, opts) {
    opts = opts || {};
    const orient = opts.orient || 'w';
    const sel = opts.selected || null;
    const legal = sel ? game.moves({ square: sel, verbose: true }) : [];
    const targets = new Set(legal.map((m) => m.to));
    const rows = game.board(); // rank 8 first (index 0 = rank 8)
    const rankIdx = orient === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const fileIdx = orient === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    let html = '<div class="board">';
    for (const r of rankIdx) {
      for (const f of fileIdx) {
        const piece = rows[r][f];
        const alg = FILES[f] + (8 - r);
        const dark = ((f + r) % 2) === 1;
        let cls = 'sq ' + (dark ? 'dark' : 'light');
        if (sel === alg) cls += ' selected';
        if (targets.has(alg)) cls += piece ? ' capture' : ' target';
        html += '<div class="' + cls + '" data-sq="' + alg + '">'
          + (piece ? glyph(piece) : '')
          + (targets.has(alg) && !piece ? '<span class="dot"></span>' : '')
          + '</div>';
      }
    }
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('.sq').forEach((el) => {
      el.addEventListener('click', () => opts.onSquare && opts.onSquare(el.dataset.sq));
    });
  }
  window.BoardView = { render };
})();
