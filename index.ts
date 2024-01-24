/* eslint-disable @typescript-eslint/no-var-requires */

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

export const combining: {
  commands: string[],
  tolatex: Record<string, {command: string, mode: 'text' | 'math'}>,
  tounicode: Record<string, string>
  regex: string
} = require('./tables/combining.json')
const combining_re = new RegExp(combining.regex)

export type MapOptions = {
  /** use mappings that require extra packages to be loaded in your document, giving better fidelity mapping. Currently supported are `MinionPro`, `MnSymbol`, `amssymb`, `arevmath`, `graphics`, `ipa`, `mathabx`, `mathrsfs`, `mathscinet`, `pmboxdraw`, `textcomp`, `tipa`, `unicode-math`, `wasysym` and `xecjk`. */
  packages?: string[]
  /** string of characters that should always be translated to math-mode TeX */
  math?: string
  /** string of characters that should always be translated to text-mode TeX */
  text?: string
  /** string of characters that should always be translated LaTeX commands, even when the map `minimal` is used. */
  ascii?: string
  /** custom mapping to add to the loaded mapping */
  charmap?: CharMap
}

export function replace_command_spacers(latex: string): string {
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
  preservecommandspacers?: boolean
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
  constructor(mode : 'bibtex' | 'biblatex' | 'minimal',  options?: MapOptions) {
    let map = { ...maps[mode].base }
    const packages = maps[mode].package
    for (const pkg of (options.packages || []).map(p => packages[p]).filter(p => p)) {
      map = { ...map, ...pkg }
    }
    for (const mode of ['text', 'math']) {
      if (!options[mode]) continue
      for (const c of options[mode]) {
        if (map[c][mode]) map[c] = { [mode]: map[c][mode] }
      }
    }
    for (const c of (options.ascii || '')) {
      if (bibtex.base[c]) map[c] = bibtex.base[c]
    }

    if (options.charmap) map = { ...map, ...options.charmap }

    this.mode = mode
    this.map = map
  }

  /**
   * Transform the given text to LaTeX
   *
   * @param text - the text to transform
   */
  tolatex(text: string, options: TranslateOptions = {}): string {
    const { bracemath, preservecommandspacers, packages } = {
      bracemath: true, preservecommandspacers: false, packages: new Set,
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
    let cd: { command: string, mode: string }

    let latex = ''
    text.normalize('NFD').replace(re, (match: string, tie: string, cdpair: string, pair: string, single: string) => {
      // console.log({ match, cdpair, tie, pair, single })
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
          if (cdc.length > 1) cdc = cdc.split('').sort().join('') // multi-combine are sorted stored
          cd = combining.tolatex[cdc]
          if (!cdmode) {
            cdmode = cd.mode
            char = (this.map[char] || { text: char, math: char })[cdmode]
          }
          if (cdmode !== cd.mode) {
            return cdc
          }

          const cmd = cd.command.match(/[a-z]/i)

          if (this.mode === 'bibtex' && cd.mode === 'text') {
            // needs to be braced to count as a single char for name abbreviation
            char = `{\\${cd.command}${cmd ? ' ': ''}${char}}`
          }
          else if (cmd && char.length === 1) {
            char = `\\${cd.command} ${char}`
          }
          else if (cmd) {
            char = `\\${cd.command}{${char}}`
          }
          else {
            char = `\\${cd.command}${char}`
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
      if (mapped.commandspacer) latex += '\0' // clean up below

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

    if (!preservecommandspacers) latex = replace_command_spacers(latex)
    return latex.normalize('NFC')
  }
}
