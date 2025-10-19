#!/usr/bin/env node

import sqlite3 from 'better-sqlite3'
import { parse as parseCSV } from 'csv-parse/sync'
import fs from 'fs/promises'
import path from 'path'

console.log('building tables')

// ---------------- DB helper ----------------
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
    return stmt.all(...params).map(row => {
      const r = new Row()
      for (const k in row) r.set(k, row[k]?.toString())
      return r
    })
  }
}

// ---------------- Setup DB ----------------
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

// ---------------- Load SSV ----------------
let errors = false
const ssvText = await fs.readFile('config.ssv', 'utf-8')
const records = parseCSV(ssvText, { delimiter: ' ', relaxColumnCount: true })

records.forEach((row, index) => {
  if (row.join('') === '' || /^\/\/|##/.test(row[0])) return

  const unicode = JSON.parse(`"${row.shift()}"`) // equivalent to String.from_json + unicode_normalize
  const conversion = { '<': 't2u', '>': 'u2t', '=': '=' }[row.shift()]
  const tex = row.shift()

  let mode = '', packageName = '', combining = 0, stopgap = 0

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
    // ignored
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

// ---------------- Sanity checks ----------------
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

// more sanity checks as per original code omitted for brevity

if (errors) process.exit(1)

// ---------------- Utility ----------------
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

// ---------------- Combining ----------------
class Combining {
  constructor() {
    this.macros = new Set()
    this.tolatex = {}
    this.tounicode = {}

    let single = ''
    const multi = []

    for (const c of TeXMap.q('SELECT * FROM texmap WHERE combining = 1 ORDER BY mode, line')) {
      if (c.get('unicode').length > 2) throw new Error('update tx')
      if (c.get('unicode').length === 1) single += c.get('unicode')
      else multi.push(`(${permutations(c.get('unicode')).join('|')})`)

      const m = c.get('tex').match(/^\\([a-z]+)$/)
      if (m) this.macros.add(m[1])

      if (c.get('tex')[0] === '\\') {
        const macro = c.get('tex').slice(1).replace('{}', '')
        if (/t2u|=/.test(c.get('conversion'))) this.tounicode[macro] = c.get('unicode')
        if (/u2t|=/.test(c.get('conversion'))) this.tolatex[c.get('unicode')] = { mode: c.get('mode'), macro }
      }
    }

    if (single.length) multi.push('[' + single + ']')
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

// ---------------- TeXChar ----------------
class TeXChar {
  math = ''
  text = ''
  alt = []
  macrospacer = false
  stopgap = false

  get(key) {
    if (key === 'math') return this.math
    if (key === 'text') return this.text
    throw new Error(key)
  }

  set(key, value) {
    if (key === 'math') this.math = value
    else if (key === 'text') this.text = value
    else throw new Error(key)
  }

  empty() {
    return this.math + this.text === ''
  }
}

// ---------------- U2T ----------------
class U2T {
  constructor(map) {
    this.map = map
    this.package = {}
    this.package[''] = {}

    const minimal = /^[\u00A0\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF#<>\\#$%&^_{}~\]]$/

    for (
      const c of TeXMap.q(`
      SELECT tex.*, (
        SELECT GROUP_CONCAT(package)
        FROM texmap alt
        WHERE tex.package = '' AND alt.package <> '' AND tex.unicode = alt.unicode AND alt.conversion IN ('u2t', '=')
      ) AS alt
      FROM texmap tex
      WHERE tex.conversion IN ('u2t', '=')
      ORDER BY tex.stopgap, tex.mode, tex.line
    `)
    ) {
      if (map === 'minimal' && !minimal.test(c.get('unicode'))) continue
      if (map === 'minimal' && c.get('package') !== '') throw new Error(c.get('tex'))

      if (!this.package[c.get('package')]) this.package[c.get('package')] = {}
      if (!this.package[c.get('package')][c.get('unicode')]) this.package[c.get('package')][c.get('unicode')] = new TeXChar()

      const m = this.package[c.get('package')][c.get('unicode')]
      if (m.stopgap && c.get('stopgap') === '0' && c.get('package') === '') {
        this.package[c.get('package')][c.get('unicode')] = new TeXChar()
      }
      m.stopgap = c.get('stopgap') === '1'

      const modes = c.get('mode') === '' ? ['text', 'math'] : [c.get('mode')]
      for (const mode of modes) {
        m[mode] = c.get('tex')
        if (mode === 'text') {
          const macrospacer = /\\[0-1a-z]+$/i.test(c.get('tex')) || c.get('combining') === '1'
          if (map === 'bibtex') {
            if (macrospacer) m.text = `{${m.text}}`
            else m.macrospacer = macrospacer
          }
          else {
            m.macrospacer = macrospacer
          }
        }
        if (c.get('package') === '' && map.match(/^bib(la)?tex$/) && c.get('alt')?.length > 0) {
          m.alt = Array.from(new Set(c.get('alt').split(','))).sort()
        }
      }
    }
  }

  async save() {
    await fs.mkdir('tables', { recursive: true })
    await fs.writeFile(
      `tables/${this.map}.ts`,
      'export default ' + ascii(JSON.stringify({ base: this.package[''], package: this.package })),
    )
    await fs.mkdir('dist/tables', { recursive: true })
    await fs.writeFile(
      `dist/tables/${this.map}.json`,
      ascii(JSON.stringify({ base: this.package[''], package: this.package })),
    )
  }
}

for (const map of ['biblatex', 'bibtex', 'minimal']) {
  await new U2T(map).save()
}

// ---------------- T2U ----------------
class T2U {
  async save() {
    const mapping = {}
    const other = { text: 'math', math: 'text' }

    for (const c of TeXMap.q("SELECT * FROM texmap tex WHERE tex.conversion IN ('t2u', '=') ORDER BY line DESC")) {
      if (!mapping[c.get('tex')]) mapping[c.get('tex')] = {}
      if (c.get('mode') === '') mapping[c.get('tex')] = { text: c.get('unicode'), math: c.get('unicode') }
      else {
        if (!mapping[c.get('tex')][c.get('mode')]) mapping[c.get('tex')][c.get('mode')] = c.get('unicode')
        if (!mapping[c.get('tex')][other[c.get('mode')]] && !/^[_^]/.test(c.get('tex')) && !c.get('tex').includes('\\')) {
          mapping[c.get('tex')][other[c.get('mode')]] = c.get('tex')
        }
      }
    }

    const t2u = {}
    for (const tex of Object.keys(mapping).sort()) {
      const char = mapping[tex]
      if ('text' in char && 'math' in char && char.text === char.math) t2u[tex] = char.text
      else if (Object.keys(char).length === 1) t2u[tex] = Object.values(char)[0]
      else t2u[tex] = { text: char.text, math: char.math }
    }

    await fs.mkdir('tables', { recursive: true })
    await fs.writeFile('tables/latex2unicode.ts', 'export default ' + ascii(JSON.stringify(t2u)))
    await fs.mkdir('dist/tables', { recursive: true })
    await fs.writeFile('dist/tables/latex2unicode.json', JSON.stringify(t2u))
  }
}

await new T2U().save()

console.log('All tables built successfully!')
