#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires, no-console */

const { Transform } = require('./index')
const samples = require('./samples.json')

// const hex = (n) => '\\u' + ('0000' + n.toString(16)).slice(-4)
// const re = /([^\u0300-\u036F][\u0300-\u036F]+)|(i\uFE20a\uFE21)|([\uD800-\uDBFF][\uDC00-\uDFFF])|(.)/g
for (let [unicode, expected] of Object.entries(samples)) {
  let mode
  // unicode.replace(re, (m, cd, tie, pair, single) => console.log(hex(m.charCodeAt(0)), hex(m.charCodeAt(1)), { m, cd, tie, pair, single }))
  if (Array.isArray(expected)) {
    [expected, mode] = expected
  }
  else {
    mode = 'biblatex'
  }
  const tx = new Transform(mode, { packages: ['textcomp', 'amsmath'] })

  const packages = new Set
  const latex = tx.tolatex(unicode, { packages })
  console.log('got:', latex, [...packages])
  if (latex !== expected) {
    console.log('exp:', expected)
    process.exit(1)
  }
  console.log('')
}

