#!/usr/bin/env node

const u2l = require('./index')

const sample = "Matrices with Small Coherence Using 𝑝-Ary Block Codes".normalize('NFC')
const nfd = sample.normalize('NFD')

console.log(sample === nfd)

const table = u2l.biblatex.base

const re = /([\uD800-\uDBFF][\uDC00-\uDFFF])|([\uD800-\uDFFF])|./g
function latex(s, packages) {
  return s.replace(re, (char, pair, single) => {
    const mapping = table[pair] || table[single] || {}
    if (mapping.alt) {
      for (const pkg of mapping.alt) {
        packages.add(pkg)
      }
    }
    const $ = mapping.math ? '$' : ''
    return $ + (mapping.text || mapping.math || char) + $
  })
}

for (let word of process.argv.slice(2).concat(sample)) {
  let packages = new Set
  console.log(latex(word, packages))
  console.log('packages:', [...packages])
}
