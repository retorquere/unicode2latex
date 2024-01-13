#!/usr/bin/env node

const u2l = require('./index')
const samples = require('./samples.json')

const table = u2l.load('biblatex', { packages: ['textcomp', 'amsmath'] })

// const hex = (n) => '\\u' + ('0000' + n.toString(16)).slice(-4)
// const re = /([^\u0300-\u036F][\u0300-\u036F]+)|(i\uFE20a\uFE21)|([\uD800-\uDBFF][\uDC00-\uDFFF])|(.)/g
for (let [unicode, expected] of Object.entries(samples)) {
  // unicode.replace(re, (m, cd, tie, pair, single) => console.log(hex(m.charCodeAt(0)), hex(m.charCodeAt(1)), { m, cd, tie, pair, single }))
  if (Array.isArray(expected)) {
    [expected, mode] = expected
  }
  else {
    mode = 'biblatex'
  }
  const packages = new Set
  const latex = u2l.tolatex(unicode, table, { mode, packages })
  console.log('got:', latex, [...packages])
  if (latex !== expected) {
    console.log('exp:', expected)
    process.exit(1)
  }
  console.log('')
}

