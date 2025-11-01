export type TeXChar = {
  math?: string
  text?: string
  macrospacer?: boolean
  stopgap?: boolean
  combining?: boolean
  alt?: string[]
}
export type CharMap = Record<string, TeXChar>
export type TeXMap = {
  base: CharMap
  package: Record<string, CharMap>
}

type Mode = 'text' | 'math'

import { table as biblatex } from './tables/biblatex.js'
export { table as biblatex } from './tables/biblatex.js'

import { table as bibtex } from './tables/bibtex.js'
export { table as bibtex } from './tables/bibtex.js'

import { table as minimal } from './tables/minimal.js'
export { table as minimal } from './tables/minimal.js'

const maps = { minimal, biblatex, bibtex }

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
  return latex
    .replace(/\0(\s)/g, '{}$1')
    .replace(/\0\s+/g, '\\_')
    .replace(/\0([^;.,!?${}_^\\/])/g, ' $1')
    .replace(/\0/g, '')
}

const switchMode: Record<Mode, Mode> = {
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
  private creator: boolean
  private minimal: boolean

  /**
   * loads a unicode -> TeX character map to use during conversion
   *
   * @param mode - the translation mode, being `bibtex`, `creator`, `biblatex` or `minimal`. Use `minimal` if your TeX environment supports unicode. In `bibtex` mode, combining characters are braced to that character/word counts are reliable, at the cost of more verbose output. `creator` is a special mode for bibtex creator that helps composite characters to be counted as a single unit for in-text citations.
   */
  constructor(mode: 'minimal' | 'biblatex' | 'bibtex' | 'bibtex-creator', options: MapOptions = {}) {
    this.creator = mode === 'bibtex-creator'
    this.minimal = mode === 'minimal'
    const base = maps[this.creator ? 'bibtex' : mode]

    let map: CharMap = base.base
    for (const pkg of (options.packages || []).map(p => base.package[p]).filter(p => p)) {
      map = { ...map, ...pkg }
    }
    map = JSON.parse(JSON.stringify(map)) as CharMap
    for (const preferred of (['text', 'math'] as Mode[])) {
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

    for (const v of Object.values(map)) {
      if (v.combining || v.text?.match(/\\[0-1a-z]+$/i)) v.macrospacer = true
    }

    this.map = map
  }

  private creatorBraces = [
    /[^{]\{/,
    /^\\[`\'^~"=.][a-z]$/i,
    /^\\[\^]\\[ij]$/,
    /^\\[kr]\{[a-zA-Z]\}$/,
  ]
  // https://github.com/retorquere/zotero-better-bibtex/issues/1189
  // Needed so that composite characters are counted as single characters
  // for in-text citation generation. This messes with the {} cleanup
  // so the resulting TeX will be more verbose; doing this only for
  // bibtex because biblatex doesn't appear to need it.
  //
  // Only testing .text because that's the only place (so far)
  // that these have turned up.
  private braceorspace(mode: Mode, text: string, macrospacer: boolean): string {
    if (mode === 'text' && this.creator) {
      if (this.creatorBraces.find(re => text.match(re))) return `{${text}}`

      let m: RegExpMatchArray

      if (m = text.match(/^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i)) return `{\\${m[1]}}`

      if (m = text.match(/^\\([a-z])\{([a-z0-9])\}$/i)) return `{\\${m[1]} ${m[2]}}`

      if (text.length > 2 && text.match(/[\\_^]/) && !text.match(/(^\{)|(\}$)/)) return `{${text}}`

      if (text.match(/\\[0-1a-z]+$/i)) return text + '\0'
    }

    return text + (macrospacer ? '\0' : '')
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
    let mode: Mode = 'text'

    const switchTo = {
      math: (bracemath ? '{$' : '$'),
      text: (bracemath ? '$}' : '$'),
    } as const

    let mapped: TeXChar
    let switched: boolean
    let m: RegExpExecArray | RegExpMatchArray
    let cd: { macro: string; mode: Mode }

    let latex = ''
    text.normalize('NFD').replace(re, (match: string, tie: string, cdpair: string, pair: string, single: string) => {
      mapped = null
      if (tie && !this.map[tie]) {
        mapped = { text: 'ia' }
      }
      else {
        mapped = this.map[tie] || this.map[pair] || this.map[single] || this.map[cdpair]
      }

      if (!mapped && !this.minimal && cdpair) {
        console.log(cdpair)
        let char = cdpair[0]
        let cdmode = ''
        cdpair = cdpair.substr(1).replace(combining_re, cdc => {
          cd = combining.tolatex[permutations(cdc).find(p => combining.tolatex[p])] // multi-combine may have different order
          // console.log({ mode: this.mode, match, cdpair, cdc, cd, tie, pair, single, mapped }) // eslint-disable-line no-console
          if (!cd) return cdc

          if (!cdmode) {
            cdmode = cd.mode
            char = (this.map[char] || { text: char, math: char })[cdmode]
          }

          if (cdmode !== cd.mode) return cdc // mode switch

          const isCmd = cd.macro.match(/[a-z]/i)

          /*
          if (this.creator && cd.mode === 'text') {
            char = `{\\${cd.macro}${isCmd ? ' ' : ''}${char}}`
          }
          else
          */
          if (isCmd && char.length === 1) {
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

      // macrospacer \0 clean up below
      latex += this.braceorspace(mode, mapped[mode], mapped.macrospacer)

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
    // @ts-expect-error TS2367
    if (mode === 'math') latex += switchTo.text

    if (!preservemacrospacers) latex = replace_macro_spacers(latex)
    return latex.normalize('NFC')
  }
}
