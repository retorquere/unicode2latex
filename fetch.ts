// tslint:disable:no-console no-magic-numbers no-eval

import { DOMParser } from 'xmldom'
import * as xpath from 'xpath'
import * as request from 'request-promise'
import * as fs from 'fs-extra'
import jsesc = require('jsesc')
import * as tmp from 'tmp-promise'
import indent = require('indent')
import * as punycode from 'punycode'

function main(asyncMain) {
  asyncMain().catch(err => {
    console.log(err)
    process.exit(1)
  })
}

function maybeIndent(lines) {
  const compact = ` ${lines.join(', ')} `
  if (compact.length < 80) return compact
  return `\n${indent(lines.join(',\n'), 2)}\n`
}

function keySort(a, b) {
  if (a.k.length !== b.k.length) return a.k.length - b.k.length
  return a.k.localeCompare(b.k)
}

function escapedJSON(obj) {
  if (Array.isArray(obj)) return `[${maybeIndent(obj.map(escapedJSON))}]`

  if (typeof obj === 'object' && obj === null) return 'null'
  if (typeof obj === 'undefined') return 'null'

  if (typeof obj === 'object') {
    let padding = 0
    const body = Object.entries(obj)
      .map(member => {
        const k = escapedJSON('' + member[0])
        const v = escapedJSON(member[1])

        if (k.length > padding) padding = k.length
        return {k, v}
      })
      .sort(keySort)
      .map(member => `${member.k.padEnd(padding, ' ')}: ${member.v}`)

    return `{${maybeIndent(body)}}`
  }

  if (typeof obj === 'string') return JSON.stringify(obj).split('').map(c => (c >= ' ' && c <= '~') ? c : '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')
  return JSON.stringify(obj)
}

class CharMap {
  private source: string
  private charmap: { [key: string]: { tex: string, mode: 'text' | 'math', source: string, target: 'unicode' | 'ascii' } }
  private always_replace = '\u00A0<>\\#$%&^_{}~'

  constructor() {
    this.source = ''
    this.charmap = {}
  }

  public async load() {
    this.baseline()

    await this.bcc()
    await this.w3('https://www.w3.org/2003/entities/2007xml/unicode.xml', 'w3.entities', '/unicode')
    await this.w3('http://www.w3.org/Math/characters/unicode.xml', 'w3.math', '')
    await this.milde()
    await this.vim()

    fs.ensureDirSync('dist')
    for (const target of ['unicode', 'ascii']) {
      const mapping = {}
      for (const [unicode, tex] of Object.entries(this.charmap)) {
        if (tex.target === target || target === 'ascii') {
          mapping[unicode] = { tex: tex.tex, math: tex.mode === 'math' }
        }
      }
      fs.writeFileSync(`dist/${target}.json`, escapedJSON(mapping))
    }
  }

  private printableASCII(cp, includeSpace = false) {
    return cp > (includeSpace ? 31 : 32) && cp < 127
  }

  private add(codepoints, mapping) {
    if (!mapping.tex) throw new Error(`${this.source}: ${codepoints} has no TeX`)

    if (!mapping.baseline) {
      mapping.tex = mapping.tex
        .replace(/([a-z]) $/i, '$1{}')
        .replace(/^_\{([-()+=0-9])\}$/, '_$1{}')
        .replace(/^\^\{([0-9])\}$/, '^$1{}')
        .replace(/^\\([="`'^~])\{(.)\}$/, '\\$1$2')
        .replace(/^\\([="`'^~])(.)\{\}$/, '\\$1$2')
        .replace(/^\{\^(.)\}$/, '^$1{}')
        .replace(/^\\([=~'`^])\{\\([ij])\}$/, '\\$1$2{}')
        .replace(/^\\c\{([CcGgKkLlNnRrSsTt])\}$/, '{\\c $1}')
        .replace(/^\\u\{([AaEeGgIiOoUu])\}$/, '{\\u $1}')
        .replace(/^\\v\{([CcDdEeLlNnRrSsTtZz])\}$/, '{\\v $1}')
        .replace(/^\\H\{([OoUu])\}$/, '{\\H $1}')
        .replace(/^\\u\{\\i\}$/, '{\\u \\i}')

      if (mapping.tex.includes('\\') && mapping.tex.match(/[a-z0-9]$/i)) mapping.tex += '{}'

    } else if (mapping.tex.match(/^\\[="`'^~][a-zA-Z]\{\}$/)) {
      throw new Error(`${this.source} defines baseline ${mapping.tex}`)

    }

    if (!Array.isArray(codepoints)) throw new Error(`${this.source}: ${codepoints} is a ${typeof codepoints}`)
    if (codepoints.find(cp => typeof cp !== 'number' || isNaN(cp))) throw new Error(`${this.source}: ${codepoints} contains non-numbers`)

    if (!codepoints.length) throw new Error(`${this.source}: empty codepoints`)

    const unicode = codepoints.map(cp => String.fromCharCode(cp)).join('').normalize('NFC')

    const disp = codepoints.map(cp => this.printableASCII(cp) ? String.fromCharCode(cp) : '\\u' + cp.toString(16).padStart(4, '0')).join('')

    const l = punycode.ucs2.decode(unicode).length
    switch (l) {
      case 0:
        return

      case 1:
        break

      case 2:
        if (codepoints.length === 2 && unicode[0] === '\\' && this.printableASCII(codepoints[1])) {
          console.log(`${this.source}.${disp}: ignoring "escaped" character for ${mapping.tex}`)
          return
        }
        break

      default:
        console.log(`${this.source}.${disp}: ignoring ${l}-char mapping for ${mapping.tex}`)
        return
    }

    let target
    if (this.always_replace.includes(unicode)) {
      target = 'unicode'
    } else if (codepoints.find(cp => !this.printableASCII(cp, true))) {
      target = 'ascii'
    } else {
      return
    }

    if (!mapping.mode) {
      if (this.charmap[unicode]) return // no redefs from modeless
      mapping.mode = 'math'
    }
    if (!['text', 'math'].includes(mapping.mode)) throw new Error(`${this.source}.${disp} => ${mapping.tex}: unexpected mode ${mapping.mode}`)

    if (mapping.tex.startsWith('\\math') && mapping.mode === 'text') {
      console.log(`${this.source}.${disp} misidentifies ${mapping.tex} as text`)
      mapping.mode = 'math'
    }

    if (mapping.mode === 'text' && unicode === mapping.tex) return

    const existing = this.charmap[unicode]
    if (existing) {
      if (existing.mode !== mapping.mode || existing.tex !== mapping.tex) {
        console.log(`${this.source}.${disp} wants to redefine (${existing.source}/${existing.mode}) "${existing.tex}" to (${this.source}/${mapping.mode}) "${mapping.tex}"`)
      }
      return
    }

    // if (!mapping.tex.trim()) throw new Error(`${this.source}.${disp} generates space`)
    if (mapping.tex === '\\\\space{}') throw new Error(`${this.source}.${disp} generates space`)
    this.charmap[unicode] = {tex: mapping.tex, mode: mapping.mode, target, source: this.source }
  }

  private async w3(url, source, root) {
    this.source = source
    const w3 = (new DOMParser).parseFromString(await request.get(url))
    let chars = 0
    for (const chr of xpath.select(`${root}/charlist/character/latex`, w3) as HTMLElement[]) {
      chars += 1
      const parent = chr.parentNode as HTMLElement
      // https://stackoverflow.com/questions/14528397/strange-behavior-for-map-parseint
      const codepoints = parent.getAttribute('dec').split('-').map(n => parseInt(n)) // tslint:disable-line:no-unnecessary-callback-wrapper

      let mode = parent.getAttribute('mode')
      if (mode === 'mixed') mode = xpath.select('mathlatex', parent).length ? 'text' : 'math'
      if (mode === 'unknown') mode = 'text'

      const tex = chr.textContent
      this.add(codepoints, { mode, tex })
    }
  }

  private async milde() {
    this.source = 'milde';
    (await request.get('http://milde.users.sourceforge.net/LUCR/Math/data/unimathsymbols.txt')).split('\n').forEach((line, lineno) => {
      if (!line || line[0] === '#') return

      const fields = line.split('^')
      if (fields.length !== 8) throw new Error(`${this.source}: ${lineno + 1} has ${fields.length} fields`)
      const codepoints = [ parseInt(fields[0], 16) ]
      const tex = fields[2] || fields[3]
      if (tex.trim()) this.add(codepoints, {mode: 'math', tex})
    })
  }

  private baseline() {
    this.source = 'baseline'

    /*
    const bbt = require('./unicode_translator_mapping.js')
    for (const target of ['unicode', 'ascii']) {
      for (const mode of ['text', 'math']) {
        for (const [chr, tex] of Object.entries(bbt[target][mode]) as any[]) {
          const codepoints = chr.split('').map(c => c.charCodeAt(0))
          this.add(codepoints, { mode, tex, baseline: true })
        }
      }
    }
    return
    */

    for (const target of ['unicode', 'ascii']) {
      const baseline = require(`./dist/${target}.json`)

      for (const [chr, tex] of Object.entries(baseline) as any[]) {
        const codepoints = chr.split('').map(c => c.charCodeAt(0))
        this.add(codepoints, { mode: tex.math ? 'math' : 'text', tex: tex.tex, baseline: true })
      }
    }
  }

  private async bcc() {
    this.source = 'biblatex-csl-converter'

    let bcc = fs.readFileSync('node_modules/biblatex-csl-converter/src/import/const.js', 'utf-8')
    bcc = bcc.replace(/export const /g, 'module.exports.').replace(/\.map\(texChar => \{[\s\S]+/, '')
    const mod = await tmp.file({postfix: '.js'})
    fs.writeFileSync(mod.path, bcc, 'utf-8')
    const TeXSpecialChars = require(mod.path).TeXSpecialChars

    for (const mapping of TeXSpecialChars) {
      if (!mapping.unicode.trim()) continue
      // escaped regex
      if (mapping.unicode.match(/^\\[{}~^$]$/)) mapping.unicode = mapping.unicode[1]

      for (const tex of mapping.tex.source.split('|')) {
        const codepoints = mapping.unicode.split('').map(c => c.charCodeAt(0))
        this.add(codepoints, { tex })
      }
    }
  }

  private async vim() {
    // there's something really wrong with this list -- see '\\grave' in that list
    return
    this.source = 'vim'
    let inmap = false
    const vim: string = (await request('https://raw.githubusercontent.com/joom/latex-unicoder.vim/master/autoload/unicoder.vim'))
      .split('\n')
      .map(line => line.trim())
      .map(line => {
        if (line.startsWith('let s:symbols = {')) {
          inmap = true
          return '{'
        }

        if (line.startsWith('\\')) {
          if (inmap) {
            inmap = (line !== '\\ }')
            return line.substr(1).replace(/(["'])\\([a-z])/i, '$1\\\\$2')
          }
        }

        return ''
      })
      .filter(line => line)
      .join('\n')

    const mod = await tmp.file({postfix: '.js'})
    fs.writeFileSync(mod.path, 'module.exports = ' + vim, 'utf-8')
    const mapping: { [key: string]: string } = require(mod.path)
    for (const [tex, chr] of Object.entries(mapping)) {
      const codepoints = chr.split('').map(c => c.charCodeAt(0))
      this.add(codepoints, { tex })
    }
  }
}

main(async () => {
  const charmap = new CharMap
  await charmap.load()
})
