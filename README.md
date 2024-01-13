Convert unicode to LaTeX

Example:

```
const { Transform } = require('unicode2latex')
const tx = new Transform(mode, { packages: ['textcomp', 'amsmath'] })
const packages = new Set
console.log(tx.tolatex('your text', { packages })
```
