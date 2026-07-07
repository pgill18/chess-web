'use strict';
// Station detail: Learn / Drill (bronze|silver|gold) / Prove (test-out). This is the webapp's
// path into the Mastery Map's core loop — clicking a station card on the map lands here.
// All scoring math (90/100 rule, delta rule) AND puzzle selection (no-repeat-within-10,
// Silver/Gold interleaving) come from lib/mastery + lib/activity verbatim — this file is glue
// only (a quiz UI), same role cli/gym.js plays for the CLI. Neither host reimplements the rules.
(function () {
  function stationPuzzles(id) { return window.Lib.activity.stationPuzzles(id); }
  function pickPuzzles(state, id, rung, count) { return window.Lib.activity.selectPuzzles(state, id, rung, count); }
  function rememberSeenByStation(state, puzzles) { return window.Lib.activity.rememberSeenByStation(state, puzzles); }

  function normSan(s) { return String(s).trim().replace(/[+#]$/, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O'); }

  // Validate `raw` as a LEGAL move in the puzzle's position FIRST — same engine validation the
  // Play view uses post-#41 — so garbage/illegal input is rejected with the engine's teaching
  // explanation instead of silently being graded as merely "wrong". Only a legal move proceeds
  // to kind-specific grading (and grading uses the engine's canonical SAN, so UCI input like
  // "e2e4" is accepted too, per the doctrine's forgiving-fallback rule).
  function gradeOne(p, raw) {
    const probe = new window.Lib.Chess(p.fen);
    let mv;
    try { mv = probe.move(raw); } catch (e) { return { ok: false, illegal: true, reason: e.message }; }
    const Puz = window.Lib.raw.puzzle;
    if (p.kind === 'strategy') return Puz.gradeStrategy(p.fen, mv.san, { declared: p.solution[0] });
    if (p.kind === 'rule' && p.ruleType === 'move-piece') return Puz.gradeMovePiece(p.fen, mv.san, p.pieceType);
    return { ok: normSan(mv.san) === normSan(p.solution[0]) };
  }

  function promptFor(p) {
    if (p.kind === 'mate') return 'White to move — mate in ' + p.mateIn;
    if (p.kind === 'rule') {
      if (p.ruleType === 'move-piece') return 'White to move — make any legal ' + (window.Lib.raw.puzzle.PIECE_WORD[p.pieceType] || p.pieceType) + ' move';
      if (p.ruleType !== 'legal-special') return 'White to move — find the only legal move';
      if (p.special === 'promotion') return 'White to move — promote your pawn to a Queen';
      return 'White to move — make the legal ' + p.special + ' move';
    }
    if (p.kind === 'strategy') return 'White to move — find a strong move (any good move counts)';
    return 'White to move — win material';
  }

  // Runs a quiz over `puzzles`; calls onDone({correct,total,missed:[{motif,station}]}).
  // missed carries each item's OWN station so an interleaved review item's miss attributes
  // to the station it came from, not the station being drilled (mirrors cli/gym.js).
  function runQuiz(root, puzzles, onDone, headerNote) {
    let i = 0, correct = 0; const missed = [];
    function ask() {
      if (i >= puzzles.length) { onDone({ correct, total: puzzles.length, missed }); return; }
      const p = puzzles[i];
      root.innerHTML = (headerNote ? '<p class="quiz-note">' + headerNote + '</p>' : '')
        + '<div class="quiz-item">'
        + '<div class="quiz-progress">' + (i + 1) + ' / ' + puzzles.length + ' <span class="motif">' + p.motif + '</span></div>'
        + '<p>' + promptFor(p) + '</p>'
        + '<div id="board-host"></div>'
        + '<div class="quiz-controls"><input id="ans" type="text" placeholder="Your move" autocomplete="off" /><button id="submit">Submit</button></div>'
        + '<div id="feedback"></div></div>';
      const g = new window.Lib.Chess(p.fen);
      let selected = null;
      function renderBoard() { window.BoardView.render(document.getElementById('board-host'), g, { selected, onSquare }); }
      function onSquare(sq) {
        const piece = g.get(sq); const isOwn = piece && piece === piece.toUpperCase();
        if (selected) {
          const opts = g.moves({ square: selected, verbose: true });
          const mv = opts.find((m) => m.to === sq);
          if (mv) { document.getElementById('ans').value = mv.san; selected = null; renderBoard(); return; }
          selected = isOwn ? sq : null; renderBoard(); return;
        }
        if (isOwn) { selected = sq; renderBoard(); }
      }
      renderBoard();
      let answered = false;
      let onEnterAdvance = null;
      const submit = () => {
        if (answered) return;
        const raw = document.getElementById('ans').value;
        const r = gradeOne(p, raw);
        const fb = document.getElementById('feedback');
        if (r.illegal) {
          // Illegal input is REJECTED, not graded — doesn't consume the attempt. Explain why
          // (same teaching text the CLI/Play view give) and let them retry immediately.
          fb.className = '';
          fb.textContent = r.reason;
          return;
        }
        answered = true;
        document.getElementById('ans').disabled = true;
        document.getElementById('submit').disabled = true;
        if (r.ok) { correct++; fb.className = 'ok'; fb.textContent = 'Correct.'; }
        else {
          missed.push({ motif: p.motif, station: p.station });
          fb.className = 'no';
          fb.textContent = 'Not quite' + (r.reason ? ' — ' + r.reason : '') + '. A good move: ' + p.solution[0] + '.'
            + (p.kind === 'strategy' && p.explanation ? '  Why: ' + p.explanation : '');
        }
        i++;
        // Explicit "Next" step — feedback stays on screen until the learner acknowledges it and
        // moves on themselves (no timed auto-advance, so it can never look like nothing happened).
        const next = document.createElement('button');
        next.id = 'next-item';
        next.textContent = (i >= puzzles.length) ? 'See results' : 'Next';
        fb.appendChild(document.createElement('br'));
        fb.appendChild(next);
        const advance = () => { document.removeEventListener('keydown', onEnterAdvance); ask(); };
        next.addEventListener('click', advance);
        onEnterAdvance = (e) => { if (e.key === 'Enter') advance(); };
        document.addEventListener('keydown', onEnterAdvance);
        next.focus();
      };
      document.getElementById('submit').addEventListener('click', submit);
      document.getElementById('ans').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
    ask();
  }

  function renderMenu(container, stationId, onBack) {
    const M = window.Lib.mastery;
    const state = window.Storage.load();
    const s = M.STATION_BY_ID[stationId];
    const pct = M.stationPercent(state, stationId);

    if (M.isArena(s)) {
      container.innerHTML = '<div class="station-detail">'
        + '<button class="back" id="back">&larr; Map</button>'
        + '<h2>' + stationId + ' ' + s.name + ' <em>' + pct + '%</em></h2>'
        + '<p>Arena milestones are earned by playing games — see Play.</p></div>';
      document.getElementById('back').addEventListener('click', onBack);
      return;
    }

    container.innerHTML = '<div class="station-detail">'
      + '<button class="back" id="back">&larr; Map</button>'
      + '<h2>' + stationId + ' ' + s.name + ' <em>' + pct + '%</em></h2>'
      + '<div class="actions">'
      + '<button data-act="learn">Learn</button>'
      + '<button data-act="drill" data-rung="bronze">Drill Bronze</button>'
      + '<button data-act="drill" data-rung="silver">Drill Silver</button>'
      + '<button data-act="drill" data-rung="gold">Drill Gold</button>'
      + '<button data-act="prove">Prove (test-out)</button>'
      + '</div><div id="activity"></div></div>';
    document.getElementById('back').addEventListener('click', onBack);
    const activity = document.getElementById('activity');
    container.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'learn') runLearn(activity, stationId, () => renderMenu(container, stationId, onBack));
      else if (act === 'drill') runDrill(activity, stationId, b.dataset.rung, () => renderMenu(container, stationId, onBack));
      else if (act === 'prove') runProve(activity, stationId, () => renderMenu(container, stationId, onBack));
    }));
  }

  function finishActivity(activity, stationId, kind, puzzles, result, backToMenu) {
    const M = window.Lib.mastery;
    const state = window.Storage.load();
    rememberSeenByStation(state, puzzles); // no-repeat-within-last-10 (spec §5)
    const passed = result.correct === result.total;
    for (const m of result.missed) M.recordMiss(state, m.station, m.motif); // per-item station (interleaving)
    let line;
    if (passed) {
      const delta = M.award(state, stationId, kind, new Date().toISOString());
      line = M.formatDelta(state, delta);
    } else {
      const nextHint = kind === 'prove' ? 'Drill ' + stationId + ' where you slipped' : stationId + ' ' + kind + ' again';
      const delta = { id: stationId, before: M.snapshot(state, stationId), after: M.snapshot(state, stationId) };
      line = M.formatDelta(state, delta, { failed: true, nextHint });
    }
    window.Storage.save(state);
    document.getElementById('overall').textContent = 'Chess Mastery ' + M.overallPercent(state) + '%';
    activity.innerHTML = '<div class="quiz-result" data-pass="' + passed + '" style="--pct:' + M.stationPercent(state, stationId) + '"><p>' + (passed ? 'Passed' : 'Not this time') + ' (' + result.correct + '/' + result.total + ').</p>'
      + '<p>' + line + '</p><button id="back2">Back to station</button></div>';
    document.getElementById('back2').addEventListener('click', backToMenu);
  }

  function runLearn(activity, stationId, backToMenu) {
    const M = window.Lib.mastery;
    const s = M.STATION_BY_ID[stationId];
    const examples = stationPuzzles(stationId).slice(0, 3);
    let html = '<div class="learn-card"><h3>Learn — ' + s.name + '</h3>';
    if (stationId === 'R4') html += '<p>Three ways out of check: move the king, block the line, or capture the checker.</p>';
    examples.forEach((ex, i) => {
      html += '<p>' + (i + 1) + '. <span class="motif">' + ex.motif + '</span> ' + ex.solution[0] + (ex.explanation ? ' — ' + ex.explanation : '') + '</p>';
    });
    html += '<button id="done">Mark learned</button></div>';
    activity.innerHTML = html;
    document.getElementById('done').addEventListener('click', () => {
      const state = window.Storage.load();
      const delta = M.award(state, stationId, 'learn', new Date().toISOString());
      window.Storage.save(state);
      document.getElementById('overall').textContent = 'Chess Mastery ' + M.overallPercent(state) + '%';
      activity.innerHTML = '<div class="quiz-result"><p>' + M.formatDelta(state, delta) + '</p><button id="back2">Back to station</button></div>';
      document.getElementById('back2').addEventListener('click', backToMenu);
    });
  }

  function runDrill(activity, stationId, rung, backToMenu) {
    const state = window.Storage.load();
    const setSize = rung === 'gold' ? 6 : 5;
    // buildDrillSet handles both no-repeat-within-10 selection AND Silver/Gold ~20% interleaving
    // from mastered same-wing stations (spec §2/§5) — same lib/activity call the CLI makes.
    const { puzzles, reviewCount } = window.Lib.activity.buildDrillSet(state, stationId, rung, setSize);
    if (puzzles.length === 0) { activity.innerHTML = '<p>No puzzles for this station yet.</p>'; return; }
    const note = reviewCount ? ('Includes ' + reviewCount + ' interleaved review item(s) from earlier mastered stations.') : null;
    runQuiz(activity, puzzles, (result) => finishActivity(activity, stationId, rung, puzzles, result, backToMenu), note);
  }

  function runProve(activity, stationId, backToMenu) {
    const state = window.Storage.load();
    const puzzles = pickPuzzles(state, stationId, null, 6);
    if (puzzles.length === 0) { activity.innerHTML = '<p>No puzzles for this station yet.</p>'; return; }
    runQuiz(activity, puzzles, (result) => finishActivity(activity, stationId, 'prove', puzzles, result, backToMenu));
  }

  window.StationView = { render: renderMenu };
})();
