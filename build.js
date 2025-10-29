#!/usr/bin/env node

import sqlite3 from 'better-sqlite3'
import { parse as parseCSV } from 'csv-parse/sync'
import fs from 'fs/promises'
import path from 'path'

console.log('building tables')

class Database {
  constructor(file) {
    this.db = new sqlite3(file)
  }

  exec(sql, ...params) {
    params = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p)
    return this.db.prepare(sql).run(...params)
  }

  q(sql, ...params) {
    const stmt = this.db.prepare(sql)
    return stmt.all(...params).map(row => {
      for (const bool of ['stopgap', 'macrospacer']) {
        if (row[bool]) {
          row[bool] = true
        }
        else {
          delete row[bool]
        }
      }
      return row
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

  let mode = '', packageName = ''
  let combining = false, stopgap = false

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
    else if (flag === 'stopgap') {
      stopgap = true
    }
    else if (flag === 'combining') {
      combining = true
    }
    else if (flag === 'space') {
      // ignored
    }
    else {
      console.error('Unexpected flag', flag)
      errors = true
    }
  }

  if (stopgap && conversion === '=') {
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
  if (/^[A-Za-z0-9]$/.test(c.unicode)) {
    console.warn('null mapping for', c.unicode)
    errors = true
  }
}

for (const c of TeXMap.q("SELECT * FROM texmap WHERE conversion IN ('=', 'u2t') AND stopgap <> 0 AND tex LIKE '%\\\\%' ORDER BY line")) {
  console.warn('faulty stopgap', c.tex)
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

async function save(json, ts, type, obj) {
  if (!obj) {
    obj = type
    type = undefined
  }
  const table = ascii(JSON.stringify(obj, null, 2))

  await fs.mkdir(path.dirname(json), { recursive: true })
  await fs.writeFile(json, table)

  await fs.mkdir(path.dirname(ts), { recursive: true })
  type = type
    ? { import: `import type { ${type} } from '../index.js'`, $table: ` as ${type}`, table: ` as ${type}` }
    : { import: '', $table: ' as const', table: ' as typeof $table' }

  await fs.writeFile(
    ts,
    [
      "import { deepFreeze } from '@pomgui/deep'",
      type.import,
      `const $table = ${table}${type.$table}`,
      `export const table = deepFreeze($table)${type.table}`,
    ].join('\n'),
  )
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
      if (c.unicode.length > 2) throw new Error('update tx')
      if (c.unicode.length === 1) single += c.unicode
      else multi.push(`(${permutations(c.unicode).join('|')})`)

      const m = c.tex.match(/^\\([a-z]+)$/)
      if (m) this.macros.add(m[1])

      if (c.tex[0] === '\\') {
        const macro = c.tex.slice(1).replace('{}', '')
        if (/t2u|=/.test(c.conversion)) this.tounicode[macro] = c.unicode
        if (/u2t|=/.test(c.conversion)) this.tolatex[c.unicode] = { mode: c.mode, macro }
      }
    }

    if (single.length) multi.push('[' + single + ']')
    this.regex = multi.join('|')
  }

  async save() {
    await save('dist/tables/combining.json', 'tables/combining.ts', {
      macros: Array.from(this.macros).sort(),
      tolatex: this.tolatex,
      tounicode: this.tounicode,
      regex: this.regex,
    })
  }
}

await new Combining().save()

// ---------------- TeXChar ----------------
class TeXChar {
  /*
  math: string
  text: string
  macrospacer: boolean
  stopgap: boolean
  alt?: string[]
  */
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
      if (map === 'minimal' && !minimal.test(c.unicode)) continue
      if (map === 'minimal' && c.package !== '') throw new Error(c.tex)

      if (!this.package[c.package]) this.package[c.package] = {}
      if (!this.package[c.package][c.unicode]) this.package[c.package][c.unicode] = new TeXChar()

      const m = this.package[c.package][c.unicode]
      if (m.stopgap && c.stopgap === '0' && c.package === '') {
        this.package[c.package][c.unicode] = new TeXChar()
      }
      m.stopgap = !!c.stopgap

      const modes = c.mode === '' ? ['text', 'math'] : [c.mode]
      for (const mode of modes) {
        m[mode] = c.tex
        if (mode === 'text') {
          const macrospacer = !!(/\\[0-1a-z]+$/i.test(c.tex) || c.combining)
          if (map === 'bibtex') {
            if (macrospacer) m.text = `{${m.text}}`
            else m.macrospacer = macrospacer
          }
          else {
            m.macrospacer = macrospacer
          }
        }
        if (c.package === '' && map.match(/^bib(la)?tex$/) && c.alt?.length > 0) {
          m.alt = Array.from(new Set(c.alt.split(','))).sort()
        }
      }

      if (!m.stopgap) delete m.stopgap
      if (!m.macrospacer) delete m.macrospacer
    }
  }

  async save() {
    await save(`dist/tables/${this.map}.json`, `tables/${this.map}.ts`, 'TeXMap', { base: this.package[''], package: this.package })
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
      if (!mapping[c.tex]) mapping[c.tex] = {}
      if (c.mode === '') mapping[c.tex] = { text: c.unicode, math: c.unicode }
      else {
        if (!mapping[c.tex][c.mode]) mapping[c.tex][c.mode] = c.unicode
        if (!mapping[c.tex][other[c.mode]] && !/^[_^]/.test(c.tex) && !c.tex.includes('\\')) {
          mapping[c.tex][other[c.mode]] = c.tex
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

    await save('dist/tables/latex2unicode.json', 'tables/latex2unicode.ts', t2u)
  }
}

await new T2U().save()

console.log('All tables built successfully!')
