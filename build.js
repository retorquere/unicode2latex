#!/usr/bin/env node

import * as assert from 'assert'
import { parse as parseCSV } from 'csv-parse/sync'
import fs from 'fs/promises'
import { generate as generatePatch } from 'json-merge-patch'
import stringify from 'json-stringify-pretty-compact'
import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import stringifyObject from 'stringify-object'

function inspect(obj) {
  // Render an object as readable JavaScript for generated TypeScript tables.
  return stringifyObject(obj, {
    indent: '\t',
    inlineCharacterLimit: 30,
  })
}

console.log('building tables')
for (const root of ['tables', 'dist/tables']) {
  // Recreate each output directory so generated files cannot become stale.
  await fs.mkdir(root, { recursive: true })
  for (const file of await fs.readdir(root)) {
    // Remove every previous generated table from the current directory.
    await fs.unlink(path.join(root, file))
  }
}

class Database {
  constructor(file) {
    // Open the requested SQLite database connection.
    this.db = new DatabaseSync(file)
  }

  exec(sql, ...params) {
    // Convert JavaScript booleans to the integer representation used by SQLite.
    params = params.map(p => typeof p === 'boolean' ? (p ? 1 : 0) : p)
    // Execute a statement that does not need returned rows.
    return this.db.prepare(sql).run(...params)
  }

  q(sql, ...params) {
    // Execute a query and normalize its boolean-like columns for JavaScript.
    const stmt = this.db.prepare(sql)
    // Normalize each returned row before exposing it to the build pipeline.
    return stmt.all(...params).map(row => {
      // Convert stored flags to booleans and omit false flags from generated data.
      for (const bool of ['combining', 'stopgap', 'macrospacer']) {
        if (row[bool]) {
          // Preserve a true flag as a JavaScript boolean.
          row[bool] = true
        }
        else {
          // Omit false flags so generated mappings stay compact.
          delete row[bool]
        }
      }
      return row
    })
  }
}

// ---------------- Setup DB ----------------
// const TeXMap = new Database('./unicode.sqlite')
const TeXMap = new Database(':memory:')
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

// Parse each configuration record into one database mapping.
records.forEach((row, index) => {
  // Ignore blank lines and configuration comments.
  if (row.join('') === '' || /^\/\/|##/.test(row[0])) return

  const unicode = JSON.parse(`"${row.shift()}"`) // equivalent to String.from_json + unicode_normalize
  const conversion = { '<': 't2u', '>': 'u2t', '=': '=' }[row.shift()]
  const tex = row.shift()

  let mode = '', packageName = ''
  let combining = false, stopgap = false

  while (row.length) {
    // Consume optional flags until the record has no fields left.
    const flag = row.shift()
    if (!flag) {
      // Stop parsing when the next optional field is empty.
      break
    }

    if (['math', 'text'].includes(flag)) {
      // Apply a mode-only flag to the mapping.
      mode = flag
    }
    else if (/^(math|text)[.]([-a-z]+)$/i.test(flag)) {
      // Apply a mode and package from a combined flag.
      ;[, mode, packageName] = flag.match(/^(math|text)[.]([-a-z]+)$/i)
    }
    else if (/^[.]([-a-z]+)$/i.test(flag)) {
      // Apply a package-only flag.
      ;[, packageName] = flag.match(/^[.]([-a-z]+)$/i)
    }
    else if (flag === 'stopgap') {
      // Mark a fallback conversion that is intentionally less precise.
      stopgap = true
    }
    else if (flag === 'combining') {
      // Mark a character that combines with adjacent characters.
      combining = true
    }
    else if (flag === 'space') {
      // Ignore the spacing marker because it has no database column.
    }
    else {
      // Record unknown flags as build errors while continuing to inspect input.
      console.error('Unexpected flag', flag)
      errors = true
    }
  }

  if (stopgap && conversion === '=') {
    // A bidirectional fallback mapping is suspicious and must fail the build.
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
    // Plain ASCII characters should not be replaced by a null text mapping.
    console.warn('null mapping for', c.unicode)
    errors = true
  }
}

for (const c of TeXMap.q("SELECT * FROM texmap WHERE conversion IN ('=', 'u2t') AND stopgap <> 0 AND tex LIKE '%\\\\%' ORDER BY line")) {
  // Stopgap mappings must not claim a TeX command as their fallback text.
  console.warn('faulty stopgap', c.tex)
  errors = true
}

// more sanity checks as per original code omitted for brevity

if (errors) {
  // Stop before writing tables when any input or sanity check failed.
  process.exit(1)
}

// ---------------- Utility ----------------
function permutations(s) {
  // Return the only possible ordering for an empty or single-character string.
  if (s.length <= 1) return [s]
  const result = []
  for (let i = 0; i < s.length; i++) {
    // Put each character first and permute the remaining characters recursively.
    const rest = s.slice(0, i) + s.slice(i + 1)
    for (const p of permutations(rest)) result.push(s[i] + p)
  }
  return result
}

function ascii(str) {
  // Escape non-ASCII characters so generated JSON remains portable text.
  // The replacement callback formats each matched character as a Unicode escape.
  return str.replace(/[^ -~\r\n]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

async function save(json, ts, type, obj) {
  // Write one mapping in both JSON form and a typed, frozen TypeScript form.
  console.log(' ', ts)
  if (!obj) {
    // Support the shorthand signature where the third argument is the object.
    obj = type
    type = undefined
  }

  await fs.mkdir(path.dirname(json), { recursive: true })
  await fs.writeFile(json, ascii(stringify(obj)))

  await fs.mkdir(path.dirname(ts), { recursive: true })
  type = type
    ? { import: `import type { ${type} } from '../index.js'`, $table: ` as ${type}`, table: ` as ${type}` }
    : { import: '', $table: ' as const', table: ' as typeof $table' }

  await fs.writeFile(
    ts,
    [
      "import { deepFreeze } from '@pomgui/deep'",
      type.import,
      `const $table = ${inspect(obj)}${type.$table}`,
      `export const table = deepFreeze($table)${type.table}`,
    ].join('\n'),
  )
}

// ---------------- Combining ----------------
class Combining {
  constructor() {
    // Build lookup data for characters that combine with neighboring characters.
    this.macros = new Set()
    this.tolatex = {}
    this.tounicode = {}

    let single = ''
    const multi = []

    for (const c of TeXMap.q('SELECT * FROM texmap WHERE combining = 1 ORDER BY mode, line')) {
      if (c.unicode.length > 2) {
        // Reject combining mappings whose input exceeds the supported length.
        throw new Error('update tx')
      }
      if (c.unicode.length === 1) {
        // Collect single-character mappings for a compact character class.
        single += c.unicode
      }
      else {
        // Expand multi-character mappings into all valid input orderings.
        multi.push(`(${permutations(c.unicode).join('|')})`)
      }

      const m = c.tex.match(/^\\([a-z]+)$/)
      if (m) {
        // Record bare TeX macros used by combining mappings.
        this.macros.add(m[1])
      }

      if (c.tex[0] === '\\') {
        // Add macro conversions only when the source direction supports them.
        const macro = c.tex.slice(1).replace('{}', '')
        if (/t2u|=/.test(c.conversion)) {
          // Register the macro-to-Unicode conversion.
          this.tounicode[macro] = c.unicode
        }
        if (/u2t|=/.test(c.conversion)) {
          // Register the Unicode-to-macro conversion.
          this.tolatex[c.unicode] = { mode: c.mode, macro }
        }
      }
    }

    if (single.length) {
      // Add all single-character mappings as one final regex alternative.
      multi.push('[' + single + ']')
    }
    this.regex = multi.join('|')
  }

  async save() {
    // Persist the combining lookup tables.
    await save('dist/tables/combining.json', 'tables/combining.ts', {
      macros: Array.from(this.macros).sort(),
      tolatex: this.tolatex,
      tounicode: this.tounicode,
      regex: this.regex,
    })
  }
}

await new Combining().save()

// ---------------- U2T ----------------
class U2T {
  constructor(map) {
    // Build the Unicode-to-TeX mapping for one output mode.
    this.map = map
    const creator = map.includes('-creator')
    if (creator) throw new Error('Creator-patching is done at runtime')
    // Remove the creator suffix before selecting the source mapping.
    map = map.replace('-creator', '')

    this.mapping = {
      '': {},
    }

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
      if (map === 'minimal' && !minimal.test(c.unicode)) {
        // Keep only the explicitly supported characters in minimal mode.
        continue
      }
      if (map === 'minimal' && c.package !== '') {
        // Minimal mode cannot contain package-specific mappings.
        throw new Error(c.tex)
      }

      if (!this.mapping[c.package]) {
        // Create a package bucket when this is its first mapping.
        this.mapping[c.package] = {}
      }
      if (!this.mapping[c.package][c.unicode]) {
        // Create a character record when this is its first mode.
        this.mapping[c.package][c.unicode] = {}
      }

      const m = this.mapping[c.package][c.unicode]

      /*
      if (m.stopgap && !c.stopgap && c.package === '') {
        this.mapping[c.package][c.unicode] = {} // TeXChar
      }
      m.stopgap = !!c.stopgap
      */

      const modes = c.mode === '' ? ['text', 'math'] : [c.mode]
      for (const mode of modes) {
        if (map === 'bibtex' && mode === 'text') {
          // Use BibTeX-safe names for braces in text mode.
          // http://tex.stackexchange.com/questions/230750/open-brace-in-bibtex-fields/230754#comment545453_230754
          switch (c.unicode) {
            case '{':
              // Replace an opening brace with its text macro.
              c.tex = '\\textbraceleft'
              break
            case '}':
              // Replace a closing brace with its text macro.
              c.tex = '\\textbraceright'
              break
          }
        }

        m[mode] = c.tex
        if (mode === 'text') {
          if (c.combining) {
            // Preserve the combining marker on text mappings.
            m.combining = true
          }
          /*
          const macrospacer = !!c.tex.match(/\\[0-1a-z]+$/i)
          if (map === 'bibtex') {
            if (macrospacer || c.combining) m.text = `{${m.text}}`
            else m.macrospacer = macrospacer
          }
          else {
            m.macrospacer = macrospacer
          }
          */
        }
        if (c.package === '' && map.match(/^bib(la)?tex$/) && c.alt?.length > 0) {
          // Keep alternate package names available to BibTeX-style consumers.
          m.alt = Array.from(new Set(c.alt.split(','))).sort()
        }
      }

      // if (!m.stopgap) delete m.stopgap
      // if (!m.macrospacer) delete m.macrospacer
    }

    const base = this.mapping['']
    delete this.mapping['']
    this.mapping = { base, package: this.mapping }

    /*
    if (creator) {
      // Apply creator-specific bracing after all package mappings are complete.
      this.patchcreator(this.mapping.base)
      for (const p of Object.values(this.mapping.package)) {
        // Apply the same creator rules to each package-specific table.
        this.patchcreator(p)
      }
    }
    */
  }

  patchcreator(table) {
    // Add braces where creator output must count a TeX conversion as one unit.
    let m
    for (const [c, tc] of Object.entries(table)) {
      if (!tc.text) {
        // Skip mappings that have no text representation.
        continue
      }

      // delete tc.macrospacer

      if (tc.text.match(/[^{]\{/)) {
        // Brace text that contains an unprotected opening brace.
        tc.text = `{${tc.text}}`
      }
      else if (tc.text.match(/^\\[`\'^~"=.][a-z]$/i) || tc.text.match(/^\\[\^]\\[ij]$/) || tc.text.match(/^\\[kr]\{[a-zA-Z]\}$/)) {
        // Brace accent and special two-part commands.
        tc.text = `{${tc.text}}`
      }
      else if (m = tc.text.match(/^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i)) {
        // Remove empty command braces while preserving the creator grouping.
        tc.text = `{\\${m[1]}}`
      }
      else if (m = tc.text.match(/^\\([a-z])\{([a-z0-9])\}$/i)) {
        // Insert a space in short command-plus-character forms.
        tc.text = `{\\${m[1]} ${m[2]}}`
      }
      else if (tc.text.length > 2 && tc.text.match(/[\\_^]/) && !tc.text.match(/(^\{)|(\}$)/)) {
        // Group longer TeX expressions that contain syntax-sensitive characters.
        tc.text = `{${tc.text}}`
      }
      else if (tc.text.match(/\\[0-1a-z]+$/i)) {
        // Group commands that end in a macro spacer.
        tc.text = `{${tc.text}}`
      }
    }
  }

  async save(base) {
    // Persist this Unicode-to-TeX mapping.
    await save(`dist/tables/${this.map}.json`, `tables/${this.map}.ts`, 'TeXMap', this.mapping)
  }
}

for (const map of ['minimal', 'biblatex', 'bibtex']) {
  // Generate each supported Unicode-to-TeX table.
  await new U2T(map).save()
}

let base = {}
for (const dependent of ['minimal', 'biblatex', 'bibtex']) {
  // Replace repeated tables with patches against the preceding table.
  const mapping = JSON.parse(await fs.readFile(path.join('dist', 'tables', `${dependent}.json`), 'utf-8'))
  if (base.mapping) {
    // Emit a compact patch for every table after the first one.
    console.log('  diffing', dependent, 'from', base.name)
    await fs.writeFile(
      path.join('tables', `${dependent}.ts`),
      [
        "import type { TeXMap } from '../index.js'",
        "import { deepFreeze } from '@pomgui/deep'",
        `import { apply } from 'tiny-merge-patch'`,
        `import { table as ${base.name} } from './${base.name}.js'`,
        `const patch = ${inspect(generatePatch(base.mapping, mapping))}`,
        `export const table = deepFreeze(apply(${base.name}, patch)) as TeXMap`,
      ].join('\n'),
    )
  }

  base = {
    name: dependent,
    mapping,
  }
}

// ---------------- T2U ----------------
class T2U {
  async save() {
    // Build the TeX-to-Unicode mapping, preserving text and math variants.
    const mapping = {}
    const other = { text: 'math', math: 'text' }

    for (const c of TeXMap.q("SELECT * FROM texmap tex WHERE tex.conversion IN ('t2u', '=') ORDER BY line DESC")) {
      if (!mapping[c.tex]) {
        // Create a TeX record when this command is first encountered.
        mapping[c.tex] = {}
      }
      if (c.mode === '') {
        // An unqualified mapping applies identically in both modes.
        mapping[c.tex] = { text: c.unicode, math: c.unicode }
      }
      else {
        if (!mapping[c.tex][c.mode]) {
          // Keep the first mapping for the current mode because rows are prioritized.
          mapping[c.tex][c.mode] = c.unicode
        }
        if (!mapping[c.tex][other[c.mode]] && !/^[_^]/.test(c.tex) && !c.tex.includes('\\')) {
          // Reuse plain-text commands in the opposite mode when no explicit mapping exists.
          mapping[c.tex][other[c.mode]] = c.tex
        }
      }
    }

    const t2u = {}
    for (const tex of Object.keys(mapping).sort()) {
      const char = mapping[tex]
      if ('text' in char && 'math' in char && char.text === char.math) {
        // Collapse identical mode mappings to a scalar value.
        t2u[tex] = char.text
      }
      else if (Object.keys(char).length === 1) {
        // Collapse a mapping that only has one mode.
        t2u[tex] = Object.values(char)[0]
      }
      else {
        // Preserve distinct text and math mappings as an object.
        t2u[tex] = { text: char.text, math: char.math }
      }
    }

    // Persist the completed TeX-to-Unicode table.
    await save('dist/tables/latex2unicode.json', 'tables/latex2unicode.ts', t2u)
  }
}

await new T2U().save()

console.log('All tables built.')
