'use strict';
// CommonJS-in-the-browser bridge. Lets the Level-2 webapp reuse lib/ BYTE-FOR-BYTE — no build
// step, no rewrites. It fetches each lib module's source and executes it with a (module, exports,
// require) shim, resolving require('./name') against an in-memory registry. Load order is
// dependency-topological so every require() resolves to an already-executed module.
//
// Every fetch is ?v=<APP_VERSION> cache-busted (the project's no-exceptions cache doctrine).
(function () {
  const registry = {};

  // require('./board') / require('./puzzles-generated.json') -> registry[basename-without-ext]
  function req(name) {
    const key = name.replace(/^.*\//, '').replace(/\.(js|json)$/, '');
    if (key in registry) return registry[key];
    throw new Error('lib module not loaded: ' + name);
  }

  // libBase e.g. '../lib'; jsonModules loaded first (data), then jsModules executed in order.
  async function loadLib(libBase, jsModules, jsonModules, version) {
    const v = 'v=' + version;
    for (const j of jsonModules) {
      const res = await fetch(`${libBase}/${j}.json?${v}`);
      if (!res.ok) throw new Error(`failed to load ${j}.json: ${res.status}`);
      registry[j] = await res.json();
    }
    const sources = {};
    for (const f of jsModules) {
      const res = await fetch(`${libBase}/${f}.js?${v}`);
      if (!res.ok) throw new Error(`failed to load ${f}.js: ${res.status}`);
      sources[f] = await res.text();
    }
    for (const f of jsModules) {
      const module = { exports: {} };
      // eslint-disable-next-line no-new-func
      const fn = new Function('module', 'exports', 'require', sources[f]);
      fn(module, module.exports, req);
      registry[f] = module.exports;
    }
    return registry;
  }

  // `self`, not `window`: on the main thread self === window (so this is a zero-behavior-change
  // rename there), but inside a Web Worker there is no `window` — `self` is the global. This lets
  // the off-main-thread compute worker (task #95) importScripts this same loader verbatim and call
  // loadLib to load lib/ exactly as the main thread does, keeping one engine, one loader, no fork.
  self.loadLib = loadLib;
  self.__libRegistry = registry;
})();
