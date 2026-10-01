// Minimal typing for webpack's `require.context` — a build-time module-globbing
// API with no runtime equivalent. We use it (see `lib/codec-normalization.ts`)
// to bundle the codec.js files shipped inside the
// `@intelligent-farming/lorawan-codec-normalization` package, which has no
// browser entry of its own. Declared here so we don't pull in
// `@types/webpack-env` just for one call signature.

interface WebpackRequireContext {
  /** Module ids (relative paths from the context root) matching the filter. */
  keys(): string[];
  /** Load the module for a given id; returns its exports. */
  (id: string): unknown;
  resolve(id: string): string;
  id: string;
}

// Augment the Node `require` (provided transitively by @types/node, which types
// the global `require` as `NodeJS.Require`) with the webpack-only `context`
// method.
declare global {
  namespace NodeJS {
    interface Require {
      context(
        directory: string,
        useSubdirectories?: boolean,
        regExp?: RegExp,
        mode?: 'sync' | 'eager' | 'weak' | 'lazy' | 'lazy-once',
      ): WebpackRequireContext;
    }
  }
}

export {};
