export type TeXChar = {
  math?: string
  text?: string
  macrospacer?: boolean
  stopgap?: boolean
  alt?: string[]
}
export type CharMap = Record<string, TeXChar>
export type TeXMap = {
  base: CharMap
  package: Record<string, CharMap>
}

import { table as biblatex } from './tables/biblatex.js'
export { table as biblatex } from './tables/biblatex.js'

import { table as bibtex } from './tables/bibtex.js'
export { table as bibtex } from './tables/bibtex.js'

import { table as minimal } from './tables/minimal.js'
export { table as minimal } from './tables/minimal.js'

const maps = { biblatex, bibtex, minimal }

import { table as latex2unicode } from './tables/latex2unicode.js'
export { table as latex2unicode } from './tables/latex2unicode.js'

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

import { table as combining } from './tables/combining.js'
export { table as combining } from './tables/combining.js'
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
  private creator: boolean

  /**
   * loads a unicode -> TeX character map to use during conversion
   *
   * @param mode - the translation mode, being `bibtex`, `creator`, `biblatex` or `minimal`. Use `minimal` if your TeX environment supports unicode. In `bibtex` mode, combining characters are braced to that character/word counts are reliable, at the cost of more verbose output. `creator` is a special mode for bibtex creator that helps composite characters to be counted as a single unit for in-text citations.
   */
  constructor(mode: 'bibtex' | 'bibtex-creator' | 'biblatex' | 'minimal', options: MapOptions = {}) {
    this.creator = mode === 'bibtex-creator'
    this.mode = mode === 'bibtex-creator' ? 'bibtex' : mode
    const packages = maps[this.mode].package
    const load = (options.packages || []).filter(p => packages[p])

    let map = maps[this.mode].base
    for (const pkg of load) {
      map = { ...map, ...packages[pkg] }
    }
    map = JSON.parse(JSON.stringify(map))
    for (const preferred of ['text', 'math']) {
      if (!(preferred in options)) continue
      for (const c of options[preferred]) {
        if (preferred in map[c]) map[c] = { [preferred]: map[c][preferred] }
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

    // https://github.com/retorquere/zotero-better-bibtex/issues/1189
    // Needed so that composite characters are counted as single characters
    // for in-text citation generation. This messes with the {} cleanup
    // so the resulting TeX will be more verbose; doing this only for
    // bibtex because biblatex doesn't appear to need it.
    //
    // Only testing ascii.text because that's the only place (so far)
    // that these have turned up.
    if (mode === 'bibtex-creator') {
      let m: RegExpMatchArray
      for (const [c, tc] of (Object.entries(map) as [string, TeXChar][])) {
        if (!tc.text) continue

        delete tc.macrospacer

        if (tc.text.match(/[^{]\{/)) {
          tc.text = `{${tc.text}}`
        }
        else if (tc.text.match(/^\\[`\'^~"=.][a-z]$/i) || tc.text.match(/^\\[\^]\\[ij]$/) || tc.text.match(/^\\[kr]\{[a-zA-Z]\}$/)) {
          tc.text = `{${tc.text}}`
        }
        else if (m = tc.text.match(/^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i)) {
          tc.text = `{\\${m[1]}}`
        }
        else if (m = tc.text.match(/^\\([a-z])\{([a-z0-9])\}$/i)) {
          tc.text = `{\\${m[1]} ${m[2]}}`
        }
        else if (tc.text.length > 2 && tc.text.match(/[\\_^]/) && !tc.text.match(/(^\{)|(\}$)/)) {
          tc.text = `{${tc.text}}`
        }
        else if (tc.text.match(/\\[0-1a-z]+$/i)) {
          tc.macrospacer = true
        }
      }
    }

    this.map = map
  }

  /**
   * Transform the given text to LaTeX
   *
   * @param text - the text to transform
   */
  tolatex(text: string, options: TranslateOptions = {}): string {
    const { bracemath, preservemacrospacers, packages } = {
      bracemath: false,
      preservemacrospacers: false,
      packages: new Set(),
      ...options,
    }
    let mode = 'text'

    const switchTo = {
      math: (bracemath ? '{$' : '$'),
      text: (bracemath ? '$}' : '$'),
    }

    let mapped: TeXChar
    let switched: boolean
    let m: RegExpExecArray | RegExpMatchArray
    let cd: { macro: string; mode: string }

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

          const isCmd = cd.macro.match(/[a-z]/i)

          if (this.mode === 'bibtex' && this.creator && cd.mode === 'text') {
            char = `{\\${cd.macro}${isCmd ? ' ' : ''}${char}}`
          }
          else if (isCmd && char.length === 1) {
            char = `\\${cd.macro} ${char}`
          }
          else if (isCmd) {
            char = `\\${cd.macro}{${char}}`
          }
          else {
            char = `\\${cd.macro}${char}`
          }
          return ''
        })
        if (!cdpair) mapped = { [cdmode]: char }
      }

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

    // might still be in math mode at the end
    if (mode === 'math') latex += switchTo.text

    if (!preservemacrospacers) latex = replace_macro_spacers(latex)
    return latex.normalize('NFC')
  }
}
