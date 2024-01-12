#!/usr/bin/env node

const u2l = require('./index')

const sample = "Matrices with Small Coherence Using 𝑝-Ary Block Codes".normalize('NFC')
const nfd = sample.normalize('NFD')

console.log(sample === nfd)

for (let word of process.argv.slice(2).concat(sample)) {
  const packages = new Set
  console.log(u2l.tolatex(word, u2l.biblatex.base, { packages }))
  console.log('packages:', [...packages])
}

