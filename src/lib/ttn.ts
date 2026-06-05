// Browser-side TTN device catalog.
//
// Importing the explicit `/browser` subpath guarantees TypeScript and webpack
// both resolve to the prebuilt-JSON entry (with `searchHits` and `builtAt`
// helpers that don't exist on the Node entry). The top-level package import
// would also work in webpack via its conditional `"browser"` export, but the
// explicit subpath sidesteps any tsc-vs-bundler condition mismatch.
//
// The `export *` (rather than a named-export list) is deliberate: the upstream
// `dist/browser.js` re-exports its enum/type module via CommonJS
// `__exportStar(require("./types"), exports)`. Webpack's static analyzer can't
// statically verify named symbols through that pattern and emits 39 false-
// positive "module has no exports" warnings if we list them by name. The
// star form opts out of static name verification entirely; symbols are still
// available at runtime (confirmed via `grep` on the bundled `main.js`).
export * from '@intelligent-farming/ttn-to-chirpstack/browser';
