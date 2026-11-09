Convert unicode to LaTeX

Example:

```
const { Transform } = require('unicode2latex')
const tx = new Transform(mode, { packages: ['textcomp', 'amsmath'] })
const packages = new Set
console.log(tx.tolatex('your text', { packages })
```

## Rebuilding Tables

Run `cargo run` from the repository root to convert `config.ssv` into JSON tables
in `dist/tables` and TypeScript tables in `tables`. The `rebuild` executable reads
the configuration at runtime and validates it before replacing generated tables.
The Makefile also uses this executable to regenerate tables during package builds.
