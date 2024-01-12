#!/usr/bin/env node

const u2l = require('./index')

// const nfc = "⩽".normalize('NFC')
const nfc = "§".normalize('NFC')
const nfd = nfc.normalize('NFD')

// const table = u2l.biblatex.package.amssymb
const table = u2l.biblatex.base

const re = /([\uD800-\uDBFF][\uDC00-\uDFFF])|(.)/g
function texify(char, pair, single) {
  console.log([char, pair, single], table[pair] || table[single])
  const mapping = table[pair] || table[single] || {}
  return mapping.text || mapping.math || char
}
function latex(s) {
  return s.replace(re, texify)
}

console.log(latex(nfc))
console.log(latex(nfd))

for (const word of process.argv.slice(2).concat(nfc)) {
  let packages = []
  console.log(latex(word))
  console.log('packages:', [...(new Set(packages))])
}
