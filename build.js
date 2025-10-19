#!/usr/bin/env node

import sqlite3 from 'better-sqlite3'
import { parse as parseCSV } from 'csv-parse/sync'
import fs from 'fs/promises'
import path from 'path'

console.log('building tables')

// --- DB helper ---
class Row extends Map {
  get(key) {
    return super.get(key)
  }
  set(key, value) {
    return super.set(key, value)
  }
}

class Database {
  constructor(file) {
    this.db = new sqlite3(file)
  }

  exec(sql, ...params) {
    return this.db.prepare(sql).run(...params)
  }

  q(sql, ...params) {
    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params)
    return rows.map(row => {
      const r = new Row()
      for (const key in row) r.set(key, row[key]?.toString())
      return r
    })
  }
}

// --- Setup DB ---
const TeXMap = new Database('./unicode.sqlite')
TeXMap.exec('DROP TABLE IF EXISTS texmap')
TeXMap.exec(`CREATE TABLE texmap (
  line INT NOT NULL,
  unicode TEXT NOT NULL,
  conversion TEXT CHECK(conversion IN ('=', 't2u', 'u2t')),
  tex TEXT NOT NULL,
  mode TEXT CHECK(mode IN ('', 'math', 'text')),
  package TEXT,
  combining INT NOT NULL CHECK(combining IN (0, 1)),
  stopgap INT NOT NULL CHECK(stopgap IN (0, 1))
)`)

// --- Parse SSV ---
let errors = false
const ssvText = await fs.readFile('config.ssv', 'utf-8')
const records = parseCSV(ssvText, { delimiter: ' ', relaxColumnCount: true })

records.forEach((row, index) => {
  if (row.join('') === '' || /^\/\/|##/.test(row[0])) return

  let unicode = JSON.parse(`"${row.shift()}"`)
  let conversionMap = { '<': 't2u', '>': 'u2t', '=': '=' }
  let conversion = conversionMap[row.shift()]
  let tex = row.shift()
  let mode = ''
  let packageName = ''
  let combining = 0
  let stopgap = 0

  while (row.length) {
    const flag = row.shift()
    if (!flag) break

    if (['math', 'text'].includes(flag)) mode = flag
    else if (/^(math|text)[.]([-a-z]+)$/i.test(flag)) {
      ;[, mode, packageName] = flag.match(/^(math|text)[.]([-a-z]+)$/i)
    }
    else if (/^[.]([-a-z]+)$/i.test(flag)) {
      ;[, packageName] = flag.match(/^[.]([-a-z]+)$/i)
    }
    else if (flag === 'stopgap') stopgap = 1
    else if (flag === 'combining') combining = 1
    else if (flag === 'space') {}
    else {
      console.error('Unexpected flag', flag)
      errors = true
    }
  }

  if (stopgap === 1 && conversion === '=') {
    console.warn(`suspect stopgap conversion for ${unicode} = ${tex}`)
    errors = true
  }

  TeXMap.exec(
    'INSERT INTO texmap (line, unicode, conversion, tex, mode, package, combining, stopgap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    index + 1,
    unicode,
    conversion,
    tex,
    mode,
    packageName,
    combining,
    stopgap,
  )
})

// ---- sanity checks ---- //
for (const c of TeXMap.q("SELECT * FROM texmap WHERE mode = 'text' ORDER BY line")) {
  if (/^[A-Za-z0-9]$/.test(c.get('unicode'))) {
    console.warn('null mapping for', c.get('unicode'))
    errors = true
  }
}

for (const c of TeXMap.q("SELECT * FROM texmap WHERE conversion IN ('=', 'u2t') AND stopgap <> 0 AND tex LIKE '%\\\\%' ORDER BY line")) {
  console.warn('faulty stopgap', c.get('tex'))
  errors = true
}

// ... More sanity checks can be translated similarly

if (errors) process.exit(1)

// --- Utility functions ---
function permutations(s) {
  if (s.length <= 1) return [s]
  const result = []
  for (let i = 0; i < s.length; i++) {
    const rest = s.slice(0, i) + s.slice(i + 1)
    for (const p of permutations(rest)) result.push(s[i] + p)
  }
  return result
}

function ascii(str) {
  return str.replace(/[^ -~\r\n]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

// --- Combining table ---
class Combining {
  constructor() {
    this.macros = new Set()
    this.tolatex = {}
    this.tounicode = {}
    const single = []
    const multi = []

    for (const c of TeXMap.q('SELECT * FROM texmap WHERE combining = 1 ORDER BY mode, line')) {
      if (c.get('unicode').length > 2) throw new Error('update tx')
      if (c.get('unicode').length === 1) single.push(c.get('unicode'))
      else multi.push(`(${permutations(c.get('unicode')).join('|')})`)

      const tex = c.get('tex')
      const m = tex.match(/^\\([a-z]+)$/)
      if (m) this.macros.add(m[1])

      if (tex[0] === '\\') {
        const macro = tex.slice(1).replace('{}', '')
        if (/t2u|=/.test(c.get('conversion'))) this.tounicode[macro] = c.get('unicode')
        if (/u2t|=/.test(c.get('conversion'))) this.tolatex[c.get('unicode')] = { mode: c.get('mode'), macro }
      }
    }

    if (single.length) multi.push('[' + single.join('') + ']')
    this.regex = multi.join('|')
  }

  async save() {
    await fs.mkdir('tables', { recursive: true })
    await fs.writeFile(
      'tables/combining.ts',
      'export default ' + ascii(JSON.stringify({
        macros: Array.from(this.macros).sort(),
        tolatex: this.tolatex,
        tounicode: this.tounicode,
        regex: this.regex,
      })),
    )

    await fs.mkdir('dist/tables', { recursive: true })
    await fs.writeFile(
      'dist/tables/combining.json',
      ascii(JSON.stringify({
        macros: Array.from(this.macros).sort(),
        tolatex: this.tolatex,
        tounicode: this.tounicode,
        regex: this.regex,
      })),
    )
  }
}

await new Combining().save()
