'use strict';
// Off-main-thread compute worker (task #95 / Skyline Phase 0 — spec §22 "play never blocks").
//
// General harness: it loads lib/ VERBATIM through the same loader bridge the main thread uses
// (importScripts js/loader.js -> self.loadLib), then runs a named pure engine computation and
// streams results back as messages. Tournaments are the first consumer; the compute-bound Skyline
// pieces (E3 sampling, in-process retrograde tablebase) are meant to reuse this same harness, so
// the job dispatch is a small registry keyed by name rather than a tournament-specific worker.
//
// WHY THIS FILE LIVES AT webapp/ ROOT (not js/): a worker resolves relative URLs against its own
// script location. From here, './lib/board.js' -> webapp/lib/board.js and 'js/loader.js' ->
// webapp/js/loader.js — both correct, with no '../' (which the L3 self-contained tree and
// scripts/check-relative-paths both forbid). If this lived in js/, './lib' would wrongly resolve
// to webapp/js/lib and the only fix would be a forbidden '../'.
//
// DETERMINISM: the WHOLE tournament (both generators) runs here, in-worker, exactly as the CLI/
// main-thread path runs it — same lib generators, same seed, same order. Nothing about running
// off-thread touches the seeded RNG streams, so a given seed still replays byte-identical (the
// clean serializable boundary otis called out in #88: params in, result messages out, no shared
// mutable state crossing postMessage).

let loaderLoaded = false;
let libPromise = null;

// manifest: { js: [...], json: [...], version: N } — passed from the main thread (single source:
// index.html's LIB_JS/LIB_JSON/APP_VERSION, exposed on window.LIB_MANIFEST), so the worker can
// never drift from the app's real load order/manifest.
function getLib(manifest) {
  if (!loaderLoaded) {
    // Cache-bust the loader fetch with the same version the app uses for its lib fetches — every
    // republish bumps APP_VERSION, so the worker always pulls a fresh loader on each release.
    self.importScripts('js/loader.js?v=' + manifest.version);
    loaderLoaded = true;
  }
  if (!libPromise) {
    libPromise = self.loadLib('./lib', manifest.js, manifest.json, manifest.version)
      .then(function (reg) { return reg.index; });
  }
  return libPromise;
}

// Job registry. Each job gets (L, args) and streams messages via post(); returns when done.
const JOBS = {
  // A full tournament: round robin, then a knockout seeded by the standings — the exact two-phase
  // flow the main thread used to drive itself, now driven here so the UI thread stays free.
  tournament: function (L, args, post) {
    let standings = null;
    for (const step of L.roundRobinSteps(args.participants, args.seed)) {
      if (step.type === 'done') { standings = step.standings; post({ type: 'rr-done', standings: standings }); }
      else post({ type: 'step', phase: 'rr', step: step });
    }
    const seeded = standings.map(function (s) { return s.key; });
    let champion = null;
    for (const step of L.knockoutSteps(seeded, args.seed)) {
      if (step.type === 'done') { champion = step.champion; }
      else post({ type: 'step', phase: 'ko', step: step });
    }
    post({ type: 'done', champion: champion });
  },
};

self.onmessage = function (e) {
  const data = e.data || {};
  const post = function (m) { self.postMessage(m); };
  getLib(data.manifest).then(function (L) {
    const job = JOBS[data.job];
    if (!job) { post({ type: 'error', message: 'unknown job: ' + data.job }); return; }
    try { job(L, data.args, post); }
    catch (err) { post({ type: 'error', message: (err && err.message) || String(err) }); }
  }).catch(function (err) {
    post({ type: 'error', message: 'engine load failed: ' + ((err && err.message) || String(err)) });
  });
};
