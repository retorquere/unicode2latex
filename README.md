Convert unicode to LaTeX

Example:

```
const { Transform } = require('unicode2latex')
const tx = new Transform(mode, { packages: ['textcomp', 'amsmath'] })
const packages = new Set
console.log(tx.tolatex('your text', { packages }))
```

## Rust/WASM for Node.js

The ESM-only `unicode2latex/wasm` entry point has the same synchronous API as the
JavaScript implementation. Translation runs in Rust; no initialization call or
Rust toolchain is needed by consumers.

```js
import { Transform, replace_macro_spacers } from 'unicode2latex/wasm'

const tx = new Transform('biblatex', { packages: ['textcomp'] })
const packages = new Set()
console.log(tx.tolatex('Michał → Nguyễn', { bracemath: true, packages }))
console.log([...packages])
```

All four modes (`minimal`, `biblatex`, `bibtex`, and `bibtex-creator`), mapping and
translation options, and table exports are available. The original package entry
point remains JavaScript and continues to support both ESM and CommonJS. The WASM
entry point is for Node.js, not browsers.

### Building and Testing

Building from source requires Node.js, a Rust toolchain, and wasm-pack:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.1 --locked
npm ci
npm run build
npm test
```

`npm run build` builds both JavaScript formats and the ESM WASM module in
`dist/wasm`. After a JavaScript build, `npm run build:wasm` rebuilds just WASM.
`npm test` runs the existing regression suite against both implementations, native
Rust tests, and differential tests covering generated mappings, package overrides,
custom maps, combining marks, spacing, and package-reporting order.

Cargo's build script validates `config.ssv` using the shared table generator and
emits sorted static Rust tables into `OUT_DIR/tables.rs`. Rust conversion uses these
tables directly, without parsing table JSON at runtime. CSV and SQLite remain
host-side generation dependencies and are not linked into WASM. The Rust library
also supports native use through `Transform`, `MapOptions`, and `TranslateOptions`;
`cargo test --lib` runs its focused tests.

## Rebuilding Tables

Run `cargo run` from the repository root to convert `config.ssv` into JSON tables
in `dist/tables` and TypeScript tables in `tables`. The `rebuild` executable reads
the configuration at runtime and validates it before replacing generated tables.
The Makefile also uses this executable to regenerate tables during package builds.
