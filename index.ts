export type TeXChar = { math?: string, text?: string, macrospacer?: boolean, alt?: string[] }
export type CharMap = Record<string, TeXChar>
export type TeXMap = {
  base: CharMap
  package: Record<string, CharMap>
  provides: Record<string, string>
  stopgap: string
}

import * as biblatex from './tables/biblatex.json' // assert { type: 'json' }
export { biblatex }
import * as bibtex from './tables/bibtex.json' // assert { type: 'json' }
export { bibtex }
import * as minimal from './tables/minimal.json' // assert { type: 'json' }
export { minimal }

const maps = { biblatex, bibtex, minimal }

import * as _latex2unicode from './tables/latex2unicode.json' // assert { type: 'json' }
export const latex2unicode = _latex2unicode as Record<string, string | { math: string } | { text: string } | {math: string, text: string }>

function permutations(str: string): string[] {
  if (str.length === 0) return []
  if (str.length === 1) return [str]

  const result: string[] = []
  for (let i = 0; i < str.length; i++) {
    const firstChar = str[i]
    const remainingChars = str.slice(0, i) + str.slice(i + 1)
    const remainingPermutations = permutations(remainingChars)
    for (let j = 0; j < remainingPermutations.length; j++) {
      result.push(firstChar + remainingPermutations[j])
    }
  }
  return result
}

import * as _combining from './tables/combining.json' // assert { type: 'json' }
export const combining = _combining as {
  macros: string[],
  tolatex: Record<string, {macro: string, mode: 'text' | 'math'}>,
  tounicode: Record<string, string>
  regex: string
}
const combining_re = new RegExp(combining.regex)

export type MapOptions = {
  /** use mappings that require extra packages to be loaded in your document, giving better fidelity mapping. Currently supported are `MinionPro`, `MnSymbol`, `amssymb`, `arevmath`, `graphics`, `ipa`, `mathabx`, `mathrsfs`, `mathscinet`, `pmboxdraw`, `textcomp`, `tipa`, `unicode-math`, `wasysym` and `xecjk`. */
  packages?: string[]
  /** string of characters that should always be translated to math-mode TeX */
  math?: string
  /** string of characters that should always be translated to text-mode TeX */
  text?: string
  /** string of characters that should always be translated LaTeX macros, even when the map `minimal` is used. */
  ascii?: string
  /** custom mapping to add to the loaded mapping */
  charmap?: CharMap
}

export function replace_macro_spacers(latex: string): string {
  return latex.replace(/\0(\s)/g, '{}$1').replace(/\0([^;.,!?${}_^\\/])/g, ' $1').replace(/\0/g, '')
}

const switchMode = {
  math: 'text',
  text: 'math',
}
const re = /(i\uFE20a\uFE21)|([^\u0300-\u036F][\u0300-\u036F]+)|([\uD800-\uDBFF][\uDC00-\uDFFF])|(.)/g
export type TranslateOptions = {
  /** add braces around math sections. This is useful if you plan to do sentencecase => TitleCase conversion on the result, so that you know these sections are protected. */
  bracemath?: boolean
  /** @ignore */
  preservemacrospacers?: boolean
  /** during conversion, package names will be added to this list that would have led to a more precise translation if they were passed to the consructor */
  packages?: Set<string>
}

export class Transform {
  private map: CharMap
  private mode: 'bibtex' | 'biblatex' | 'minimal'

  /**
   * loads a unicode -> TeX character map to use during conversion
   *
   * @param mode - the translation mode, being `bibtex`, `biblatex` or `minimal`. Use `minimal` if your TeX environment supports unicode. In `bibtex` mode, combining characters are braced to that character/word counts are reliable, at the cost of more verbose output.
   */
  constructor(mode : 'bibtex' | 'biblatex' | 'minimal',  options: MapOptions = {}) {
    let map = { ...maps[mode].base }
    const packages = maps[mode].package
    for (const pkg of (options.packages || []).map(p => packages[p]).filter(p => p)) {
      map = { ...map, ...pkg }
    }
    for (const mode of ['text', 'math']) {
      if (!(mode in options)) continue
      for (const c of options[mode]) {
        if (mode in map[c]) map[c] = { [mode]: map[c][mode] }
      }
    }
    for (const c of (options.ascii || '')) {
      if (bibtex.base[c]) map[c] = bibtex.base[c]
    }

    if (options.charmap) {
      for (const [u, t] of Object.entries(options.charmap)) {
        map[u.normalize('NFC')] = map[u.normalize('NFD')] = t
      }
    }
    this.mode = mode
    this.map = map
  }

  /**
   * Transform the given text to LaTeX
   *
   * @param text - the text to transform
   */
  tolatex(text: string, options: TranslateOptions = {}): string {
    const { bracemath, preservemacrospacers, packages } = {
      bracemath: false, preservemacrospacers: false, packages: new Set,
      ...options,
    }
    let mode = 'text'
    let braced = 0

    const switchTo = {
      math: (bracemath ? '{$' : '$'),
      text: (bracemath ? '$}' : '$'),
    }

    let mapped: TeXChar
    let switched: boolean
    let m: RegExpExecArray | RegExpMatchArray
    let cd: { macro: string, mode: string }

    let latex = ''
    text.normalize('NFD').replace(re, (match: string, tie: string, cdpair: string, pair: string, single: string) => {
      mapped = null
      if (tie && !this.map[tie]) {
        mapped = { text: 'ia' }
      }
      else {
        mapped = this.map[tie] || this.map[pair] || this.map[single] || this.map[cdpair]
      }

      if (!mapped && this.mode !== 'minimal' && cdpair) {
        let char = cdpair[0]
        let cdmode = ''
        cdpair = cdpair.substr(1).replace(combining_re, cdc => {
          cd = combining.tolatex[permutations(cdc).find(p => combining.tolatex[p])] // multi-combine may have different order
          // console.log({ match, cdpair, cdc, cd, tie, pair, single, mapped }) // eslint-disable-line no-console
          if (!cd) return cdc

          if (!cdmode) {
            cdmode = cd.mode
            char = (this.map[char] || { text: char, math: char })[cdmode]
          }

          if (cdmode !== cd.mode) return cdc // mode switch

          const cmd = cd.macro.match(/[a-z]/i)

          if (this.mode === 'bibtex' && cd.mode === 'text') {
            // needs to be braced to count as a single char for name abbreviation
            char = `{\\${cd.macro}${cmd ? ' ': ''}${char}}`
          }
          else if (cmd && char.length === 1) {
            char = `\\${cd.macro} ${char}`
          }
          else if (cmd) {
            char = `\\${cd.macro}{${char}}`
          }
          else {
            char = `\\${cd.macro}${char}`
          }
          return ''
        })
        if (!cdpair) mapped = { [cdmode] : char }
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
      if (mapped.macrospacer) latex += '\0' // clean up below

      // only try to merge sup/sub if we were already in math mode, because if we were previously in text mode, testing for _^ is tricky.
      if (!switched && mode === 'math' && (m = latex.match(/(([\^_])\{[^{}]+)\}\2{(.\})$/))) {
        latex = latex.slice(0, latex.length - m[0].length) + m[1] + m[3]
      }

      if (mapped.alt) {
        for (const pkg of mapped.alt) {
          packages.add(pkg)
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

    if (!preservemacrospacers) latex = replace_macro_spacers(latex)
    return latex.normalize('NFC')
  }
}
