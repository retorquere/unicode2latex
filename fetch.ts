// tslint:disable:no-console no-magic-numbers no-eval

// https://wiki.contextgarden.net/Word-to-LaTeX
// https://github.com/physikerwelt/utf8tex/blob/master/unicode2tex.csv

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
  if (compact.length < 120) return compact
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
      .map(member => {
        if (member.includes('\n')) return member

        const colon = member.indexOf(':')
        return member.slice(0, colon + 2) + JSON.stringify(JSON.parse(member.slice(colon + 2)), null, 1).replace(/\n/g, '')
      })

    return `{${maybeIndent(body)}}`
  }

  if (typeof obj === 'string') return JSON.stringify(obj).split('').map(c => (c >= ' ' && c <= '~') ? c : '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')
  return JSON.stringify(obj)
}

class CharMap {
  private source: string
  private charmap: {
    [key: string]: {
      text?: string,
      math?: string,
      source: {
        text?: string,
        math?: string,
      },
      target: 'unicode' | 'ascii'
    }
  }
  private package: { [key: string]: string }
  private always_replace = '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF<>\\#$%&^_{}~'

  constructor() {
    this.source = ''
    this.charmap = {}
    this.package = {}
  }

  public async load() {
    this.baseline()

    await this.bcc()
    await this.w3('https://www.w3.org/2003/entities/2007xml/unicode.xml', 'w3.entities', '/unicode')
    await this.w3('http://www.w3.org/Math/characters/unicode.xml', 'w3.math', '')
    await this.milde()
    await this.vim()

    await this.textcomp()

    fs.ensureDirSync('tables')
    for (const target of ['unicode', 'ascii']) {
      const mapping = {}
      for (const [unicode, tex] of Object.entries(this.charmap)) {
        if (tex.target === target || target === 'ascii') {
          mapping[unicode] = {
            text: tex.text,
            math: tex.math,
            space: '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF'.includes(unicode),
          }
          if (!mapping[unicode].text) delete mapping[unicode].text
          if (!mapping[unicode].math) delete mapping[unicode].math
          if (!mapping[unicode].space) delete mapping[unicode].space

          if (mapping[unicode].text && mapping[unicode].text.includes('\\fontencoding') && mapping[unicode].math && !mapping[unicode].math.includes('\\fontencoding')) {
            delete mapping[unicode].text
          }
          if (mapping[unicode].text && this.package[mapping[unicode].text]) mapping[unicode].textpackage = this.package[mapping[unicode].text]
          if (mapping[unicode].math && this.package[mapping[unicode].math]) mapping[unicode].mathpackage = this.package[mapping[unicode].math]

          if (!mapping[unicode].text && !mapping[unicode].math) throw new Error('No TeX')
          if (mapping[unicode].text && mapping[unicode].math) console.log('dual-mapping', mapping[unicode])
        }
      }
      fs.writeFileSync(`tables/${target}.json`, escapedJSON(mapping))
    }
  }

  private printableASCII(ch) {
    return (ch > ' ') && (ch < '~')
  }

  private add(unicode, mapping) {
    if (typeof unicode !== 'string') throw new Error(`${unicode} is not a string`)

    const disp = Array.from(unicode).map(cp => this.printableASCII(cp) ? cp : `\\u${cp.codePointAt(0).toString(16).padStart(4, '0')}`).join('')

    if (!mapping.tex) throw new Error(`${this.source}: ${disp} has no TeX`)

    const l = punycode.ucs2.decode(unicode).length
    switch (l) {
      case 0:
        throw new Error(`${this.source}: empty unicode match`)

      case 1:
        break

      case 2:
        if (unicode[0] === '\\' && this.printableASCII(unicode[1])) {
          console.log(`${this.source}.${disp}: ignoring "escaped" character for ${mapping.tex}`)
          return
        }
        break

      default:
        console.log(`${this.source}.${disp}: ignoring ${l}-char mapping for ${mapping.tex}`)
        return
    }

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

      if (mapping.tex.includes('\\') && mapping.tex.match(/[a-z0-9]$/i) && !mapping.tex.match(/^\\[="`'^~].$/)) mapping.tex += '{}'

    } else if (mapping.tex.match(/^\\[="`'^~][a-zA-Z]\{\}$/)) {
      throw new Error(`${this.source} defines baseline ${mapping.tex}`)

    }

    let target
    if (this.always_replace.includes(unicode)) {
      target = 'unicode'
    } else if (Array.from(unicode).find(cp => cp !== ' ' && !this.printableASCII(cp))) {
      target = 'ascii'
    } else { // only printable ASCII, no special TeX chars
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
      if ((existing[mapping.mode] || mapping.tex) !== mapping.tex) {
        console.log(`${this.source}.${disp} wants to redefine (${existing.source[mapping.mode]}/${mapping.mode}) "${existing[mapping.mode]}" to (${this.source}/${mapping.mode}) "${mapping.tex}"`)
        return
      }
    }

    if (unicode === ' ') throw new Error(`${this.source}.${disp} => ${mapping.tex} matches space`)
    if (mapping.tex === '\\\\space{}') throw new Error(`${this.source}.${disp} generates space`)

    this.charmap[unicode] = existing || { target, source: {} }
    this.charmap[unicode].source[mapping.mode] = this.source
    this.charmap[unicode][mapping.mode] = mapping.tex
  }

  private async w3(url, source, root) {
    this.source = source
    const w3 = (new DOMParser).parseFromString(await request.get(url))
    let chars = 0
    for (const chr of xpath.select(`${root}/charlist/character/latex`, w3) as HTMLElement[]) {
      chars += 1
      const parent = chr.parentNode as HTMLElement
      // https://stackoverflow.com/questions/14528397/strange-behavior-for-map-parseint
      const unicode = String.fromCodePoint.apply(null, parent.getAttribute('dec').split('-').map(n => parseInt(n))) // tslint:disable-line:no-unnecessary-callback-wrapper

      let mode = parent.getAttribute('mode')
      if (mode === 'mixed') mode = xpath.select('mathlatex', parent).length ? 'text' : 'math'
      if (mode === 'unknown') mode = 'text'

      const tex = chr.textContent
      this.add(unicode, { mode, tex })
    }
  }

  private async milde() {
    this.source = 'milde';
    (await request.get('http://milde.users.sourceforge.net/LUCR/Math/data/unimathsymbols.txt')).split('\n').forEach((line, lineno) => {
      if (!line || line[0] === '#') return

      const fields = line.split('^')
      if (fields.length !== 8) throw new Error(`${this.source}: ${lineno + 1} has ${fields.length} fields`)
      const unicode = String.fromCodePoint(parseInt(fields[0], 16))
      const tex = fields[2] || fields[3]
      if (tex.trim()) this.add(unicode, {mode: 'math', tex})
    })
  }

  private baseline() {
    this.source = 'baseline'

    /*
    const bbt = require('./unicode_translator_mapping.js')
    for (const target of ['unicode', 'ascii']) {
      for (const mode of ['text', 'math']) {
        for (const [unicode, tex] of Object.entries(bbt[target][mode]) as any[]) {
          this.add(unicode, { mode, tex, baseline: true })
        }
      }
    }
    return
    */

    const baseline = require('./tables/ascii.json')
    for (const [unicode, tex] of Object.entries(baseline) as any[]) {
      if (tex.math) this.add(unicode, { mode: 'math', tex: tex.math, baseline: true })
      if (tex.text) this.add(unicode, { mode: 'text', tex: tex.text, baseline: true })
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
        this.add(mapping.unicode, { tex })
      }
    }
  }

  private async textcomp() {
    const textcomp: string = await request('http://ctan.triasinformatica.nl/obsolete/fonts/psfonts/ts1/textcomp.dtx')
    for (const line of textcomp.split('\n')) {
      const m = line.match(/^\\DeclareTextSymbol{(.*?)}/)
      if (m) this.package[`${m[1]}{}`] = 'textcomp'
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
    for (const [tex, unicode] of Object.entries(mapping)) {
      this.add(unicode, { tex })
    }
  }
}

main(async () => {
  const charmap = new CharMap
  await charmap.load()
})
