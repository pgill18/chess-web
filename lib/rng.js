'use strict';

// Deterministic seeded PRNG (mulberry32). Pure — same seed always yields the same
// sequence, so any reported game (human moves + seed + level) replays exactly.

function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // integer in [0, n)
  rng.int = (n) => Math.floor(rng() * n);
  return rng;
}

module.exports = { makeRng };
