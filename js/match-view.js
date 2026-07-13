'use strict';
// Async match via self-contained copy-paste codes (spec §4). No backend: the code IS the match
// state (lib/matchcode). Correspondence-chess pattern — load a code (or start fresh), make one
// move, get a new code back to send to the other player through any external channel.
(function () {
  let root, g, code, selected;

  function start(container) {
    root = container;
    renderIntro();
  }

  function renderIntro() {
    root.innerHTML = '<div class="match-setup">'
      + '<h2>Async Match</h2>'
      + '<p>No account, no server — the code below <em>is</em> the game. Share it with the other '
      + 'player through chat, email, anywhere; they paste it in to load their turn.</p>'
      + '<button id="m-new">New match</button>'
      + '<div class="match-or">or</div>'
      + '<label>Paste a code<br /><input type="text" id="m-code" placeholder="paste a match code here" style="width:100%" /></label>'
      + '<button id="m-load">Load</button>'
      + '<div id="m-error" class="error"></div>'
      + '</div>';
    document.getElementById('m-new').addEventListener('click', () => loadCode(window.Lib.newMatchCode()));
    document.getElementById('m-load').addEventListener('click', () => {
      const c = document.getElementById('m-code').value.trim();
      if (!c) { document.getElementById('m-error').textContent = 'Paste a code first.'; return; }
      loadCode(c);
    });
  }

  function loadCode(c) {
    const L = window.Lib;
    try { g = L.gameFromCode(c); } catch (e) { document.getElementById('m-error').textContent = e.message; return; }
    code = c;
    selected = null;
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
    const over = g.isGameOver();
    root.innerHTML = '<div class="play-wrap">'
      + '<div id="board-host"></div>'
      + '<aside class="play-side">'
      + '<div class="status">' + s.text + '</div>'
      + '<div id="msg">' + (msg || '') + '</div>'
      + (over ? '' : '<p>Make your move, then copy the new code below and send it to the other player.</p>')
      + '<label>Match code (copy this to share)<br />'
      + '<textarea id="m-current-code" readonly style="width:100%;height:4em">' + code + '</textarea></label>'
      + '<button id="m-copy">Copy code</button>'
      + '<button id="m-back">New / load a different match</button>'
      + '<ol class="movelist">' + moveListHtml() + '</ol>'
      + '</aside></div>';
    window.BoardView.render(document.getElementById('board-host'), g, { orient: g.turn(), selected, onSquare });
    document.getElementById('m-back').addEventListener('click', renderIntro);
    document.getElementById('m-copy').addEventListener('click', () => {
      const ta = document.getElementById('m-current-code');
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* clipboard API unavailable — selection still lets the user Ctrl+C */ }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).catch(() => {});
    });
  }

  function onSquare(sq) {
    if (g.isGameOver()) return;
    const piece = g.get(sq);
    const isOwn = piece && (g.turn() === 'w' ? (piece >= 'A' && piece <= 'Z') : (piece >= 'a' && piece <= 'z'));
    if (selected) {
      const opts = g.moves({ square: selected, verbose: true });
      const mv = opts.find((m) => m.to === sq);
      if (mv) { doMove({ from: selected, to: sq, promotion: mv.promotion ? 'q' : undefined }); return; }
      if (isOwn) { selected = sq; render(); return; }
      const from = selected; selected = null;
      try { g.move({ from, to: sq }); render(); return; } catch (e) { render(e.message); return; }
    }
    if (isOwn) { selected = sq; render(); }
  }

  function doMove(input) {
    const L = window.Lib;
    let result;
    try { result = L.appendMoveToCode(code, input); } catch (e) { render(e.message); return; }
    code = result.code;
    g = result.game;
    selected = null;
    render(result.move.san + ' played — new code generated below.');
  }

  window.MatchView = { start };
})();
