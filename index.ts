export type TeXChar = { math?: string, text?: string, commandspacer?: boolean, alt?: string[] }
export type CharMap = Record<string, TeXChar>
export type TeXMap = {
  base: CharMap
  package: Record<string, CharMap>
  provides: Record<string, string>
  stopgap: string
}

export const biblatex: TeXMap = require('./tables/biblatex.json')
export const bibtex: TeXMap = require('./tables/bibtex.json')
export const minimal: TeXMap = require('./tables/minimal.json')

const maps = { biblatex, bibtex, minimal }

export const latex2unicode: Record<string, string> = require('./tables/latex2unicode.json')

export const diacritics: {
  commands: string[],
  tolatex: Record<string, {command: string, mode: 'text' | 'math'}>,
  tounicode: Record<string, string>
} = require('./tables/diacritics.json')

export type MapOptions = {
  packages?: string[]
  math?: string
  text?: string
  ascii?: string
  charmap?: CharMap
}

export function load(mode : 'bibtex' | 'biblatex' | 'minimal',  options?: MapOptions): CharMap {
  let map = { ...maps[mode].base }
  const packages = maps[mode].package
  for (const pkg of (options.packages || []).map(p => packages[p]).filter(p => p)) {
    map = { ...map, ...pkg }
  }
  for (const c of (options.text || '')) {
    if (map[c].text) delete map[c].math
  }
  for (const c of (options.math || '')) {
    if (map[c].math) delete map[c].text
  }
  for (const c of (options.ascii || '')) {
    if (bibtex.base[c]) map[c] = bibtex.base[c]
  }

  if (options.charmap) map = { ...map, ...options.charmap }
  return map
}

export function replace_command_spacers(latex: string): string {
  return latex.replace(/\0(\s)/g, '{}$1').replace(/\0([^;.,!?${}_^\\/])/g, ' $1').replace(/\0/g, '')
}

const switchMode = {
  math: 'text',
  text: 'math',
}
const re = /([^\u0300-\u036F][\u0300-\u036F]+)|(i\uFE20a\uFE21)|([\uD800-\uDBFF][\uDC00-\uDFFF])|([\uD800-\uDFFF])|./g
export type TranslateOptions = {
  bracemath?: boolean
  mode?: 'minimal' | 'bibtex' | 'biblatex'
  preservecommandspacers?: boolean
  packages?: Set<string>
}
export function tolatex(text: string, table: CharMap, options: TranslateOptions = {}) {
  options = { bracemath: false, mode: 'biblatex', preservecommandspacers: false, packages: new Set, ...options}
  let mode = 'text'
  let braced = 0

  const switchTo = {
    math: (options.bracemath ? '{$' : '$'),
    text: (options.bracemath ? '$}' : '$'),
  }

  let mapped // : TeXChar
  let switched // : boolean
  let m // : RegExpExecArray | RegExpMatchArray
  let cd // : { command: string, mode: string }

  let latex = ''
  text.replace(re, (match: string, cdpair: string, tie: string, pair: string, single: string) => {
    mapped = null
    if (tie && !table[tie]) {
      mapped = { text: 'ia' }
    }
    else {
      // does that last one do anything?
      mapped = table[tie] || table[cdpair] || table[pair] || table[single] || (cdpair && table[cdpair.normalize('NFC')])
    }

    if (!mapped && options.mode !== 'minimal' && cdpair && (cd = diacritics.tolatex[cdpair.substr(1)])) {
      let char
      if (char = (table[cdpair[0]] || { text: cdpair[0], math: cdpair[0] })[cd.mode]) {
        const cmd = cd.command.match(/[a-z]/)

        if (options.mode === 'bibtex' && cd.mode === 'text') {
          // needs to be braced to count as a single char for name abbreviation
          mapped = ({ [cd.mode]: `{\\${cd.command}${cmd ? ' ': ''}${char}}` } /*as TeXChar*/)
        }
        else if (cmd && char.length === 1) {
          mapped = ({ [cd.mode]: `\\${cd.command} ${char}` } /*as TeXChar*/)
        }
        else if (cmd) {
          mapped = ({ [cd.mode]: `\\${cd.command}{${char}}` } /*as TeXChar*/)
        }
        else {
          mapped = ({ [cd.mode]: `\\${cd.command}${char}` } /*as TeXChar*/)
        }
      }
    }

    /* ??
    if (!mapped && text[i + 1] && (mapped = this.mapping[text.substr(i, 2)])) {
      i += 1
    }
    */
    // fallback -- single char mapping
    if (!mapped) mapped = { text: match }

    // in and out of math mode
    if (!mapped[mode]) {
      mode = switchMode[mode]
      latex += switchTo[mode]
      switched = true
    }
    else {
      switched = false
    }

    // balance out braces with invisible braces until
    // http://tex.stackexchange.com/questions/230750/open-brace-in-bibtex-fields/230754#comment545453_230754
    // is widely deployed
    switch (mapped[mode]) {
      case '\\{': braced += 1; break
      case '\\}': braced -= 1; break
    }
    if (braced < 0) {
      latex += '\\vphantom\\{'
      braced = 0
    }

    // if we just switched out of math mode, and there's a lone sup/sub at the end, unpack it.
    // The extra option brace is for when we're not in bracemath mode (see switchTo)
    if (switched && mode === 'text' && (m = latex.match(/([\^_])\{(.)\}(\$\}?)$/))) {
      latex = latex.slice(0, latex.length - m[0].length) + m[1] + m[2] + m[3]
    }

    latex += mapped[mode]
    if (mapped.commandspacer) latex += '\0' // clean up below

    // only try to merge sup/sub if we were already in math mode, because if we were previously in text mode, testing for _^ is tricky.
    if (!switched && mode === 'math' && (m = latex.match(/(([\^_])\{[^{}]+)\}\2{(.\})$/))) {
      latex = latex.slice(0, latex.length - m[0].length) + m[1] + m[3]
    }

    if (mapped.alt) {
      for (const pkg of mapped.alt) {
        options.packages.add(pkg)
      }
    }
    return match // pacify tsc
  })

  // add any missing closing phantom braces
  switch (braced) {
    case 0:
      break
    case 1:
      latex += '\\vphantom\\}'
      break
    default:
      latex += `\\vphantom{${'\\}'.repeat(braced)}}`
      break
  }

  // might still be in math mode at the end
  if (mode === 'math') latex += switchTo.text

  // does this do anything?
  // latex = latex.normalize('NFC')
  if (!options.preservecommandspacers) replace_command_spacers(latex)
  return latex
}
