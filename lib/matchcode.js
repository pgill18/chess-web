'use strict';

// Self-contained async-match codes (PRODUCT-SPEC §4: "compact copy-paste codes in the webapp").
// No backend/relay — the code IS the match state (start FEN + SAN move history), base64url-
// encoded. Players exchange codes through any external channel (chat, email); decoding always
// REPLAYS the full history through the real engine, so threefold/50-move state is derived
// correctly, not just guessed from a bare final FEN. Pure, I/O-free — reused by the CLI and the
// webapp verbatim.
//
// Portable custom base64url codec (no Node Buffer / browser btoa dependency) — this file loads
// through the SAME CommonJS bridge in both Node and the browser, so it must work identically in
// both without relying on either host's built-ins.

const { Chess } = require('./game');
const { START_FEN } = require('./board');

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE_VERSION = 1;

function toBytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.codePointAt(i);
    if (code > 0xffff) i++; // consumed the low half of a surrogate pair
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

function fromBytes(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b0 = bytes[i];
    if (b0 < 0x80) { out += String.fromCharCode(b0); }
    else if ((b0 & 0xe0) === 0xc0) { out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[++i] & 0x3f)); }
    else if ((b0 & 0xf0) === 0xe0) { out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f)); }
    else {
      const cp = ((b0 & 0x07) << 18) | ((bytes[++i] & 0x3f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

function encodeBase64Url(str) {
  const bytes = toBytes(str);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const triplet = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    out += B64URL[(triplet >> 18) & 0x3f];
    out += B64URL[(triplet >> 12) & 0x3f];
    out += (i + 1 < bytes.length) ? B64URL[(triplet >> 6) & 0x3f] : '';
    out += (i + 2 < bytes.length) ? B64URL[triplet & 0x3f] : '';
  }
  return out;
}

function decodeBase64Url(s) {
  const rev = {};
  for (let i = 0; i < B64URL.length; i++) rev[B64URL[i]] = i;
  const bytes = [];
  let buffer = 0, bits = 0;
  for (const ch of String(s)) {
    if (!(ch in rev)) continue; // tolerate whitespace/newlines from a pasted code
    buffer = (buffer << 6) | rev[ch];
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 0xff); }
  }
  return fromBytes(bytes);
}

// match: { startFen?, history: [SAN...] } -> compact code string.
function encodeMatch(match) {
  const payload = { v: CODE_VERSION, h: match.history || [] };
  if (match.startFen && match.startFen !== START_FEN) payload.f = match.startFen;
  return encodeBase64Url(JSON.stringify(payload));
}

// code string -> { startFen, history }. Throws a teaching-style Error on a malformed/corrupt code.
// Known payload versions this decoder understands. Bump CODE_VERSION and add a migration branch
// here (rather than just widening this set) when the payload shape actually changes.
const KNOWN_VERSIONS = [1];

function decodeMatch(code) {
  let payload;
  try { payload = JSON.parse(decodeBase64Url(code)); } catch (e) { payload = null; }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.h)) {
    throw new Error('That code is not valid — check for typos or a truncated paste.');
  }
  if (!KNOWN_VERSIONS.includes(payload.v)) {
    throw new Error(`That code is from a newer or unrecognized version (v${payload.v}) — this app only understands v${KNOWN_VERSIONS.join('/')}.`);
  }
  return { startFen: payload.f || START_FEN, history: payload.h };
}

// Rebuild a live Chess game from a code by replaying its full history (correct threefold/50-move
// state, not just the final position). Throws if the code's own history is internally illegal.
function gameFromCode(code) {
  const { startFen, history } = decodeMatch(code);
  const g = new Chess(startFen);
  for (const san of history) g.move(san);
  return g;
}

// Apply one move to a decoded match and return the NEW code to send back, plus the game/move.
function appendMoveToCode(code, moveInput) {
  const { startFen, history } = decodeMatch(code);
  const g = new Chess(startFen);
  for (const san of history) g.move(san);
  const move = g.move(moveInput); // throws the engine's teaching message if illegal
  return { code: encodeMatch({ startFen, history: history.concat([move.san]) }), game: g, move };
}

// A fresh match code (optionally from a specific starting FEN, for constructing test positions).
function newMatchCode(startFen) {
  return encodeMatch({ startFen: startFen || START_FEN, history: [] });
}

module.exports = {
  encodeMatch, decodeMatch, gameFromCode, appendMoveToCode, newMatchCode,
  encodeBase64Url, decodeBase64Url, CODE_VERSION,
};
