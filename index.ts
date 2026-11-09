import allPermutations from 'just-permutations'

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

import { table as combining } from './tables/combining.js'
export { table as combining } from './tables/combining.js'

/*
function codes(s) {
  return [...(s || '')].map(c => !c.match(/[\u0020-\u007e]/) ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase() : c).join('')
}
*/

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

/**
 * Replace internal macro-boundary markers with TeX-safe spacing or grouping.
 * @param latex - translated TeX that may contain NUL markers after control words
 * @returns TeX with all internal markers removed
 */
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
   * @param options - optional package maps and per-character mapping preferences
   */
  constructor(mode: 'minimal' | 'biblatex' | 'bibtex' | 'bibtex-creator', options: MapOptions = {}) {
    this.creator = mode === 'bibtex-creator'
    this.minimal = mode === 'minimal'
    // Creator mode uses the bibtex table, then applies creator-specific grouping below.
    const base = maps[this.creator ? 'bibtex' : mode]

    let map: CharMap = base.base
    // Package maps are layered in the requested order; later maps override earlier entries.
    for (const pkg of (options.packages || []).map(p => base.package[p]).filter(p => p)) {
      map = { ...map, ...pkg }
    }
    // Work on a deep copy so per-instance adjustments do not mutate shared table data.
    map = JSON.parse(JSON.stringify(map)) as CharMap
    for (const preferred of (['text', 'math'] as Mode[])) {
      if (!(preferred in options)) continue
      const forced = options[preferred] ?? ''
      // Keep only the requested output mode for explicitly preferred characters.
      for (const c of forced) {
        if (preferred in map[c]) map[c] = { [preferred]: map[c][preferred] }
      }
    }
    // ASCII overrides restore bibtex mappings even when another map was selected.
    for (const c of (options.ascii || '')) {
      if (bibtex.base[c]) map[c] = bibtex.base[c]
    }

    if (options.charmap) {
      // Store custom entries under both normalization forms used by conversion.
      for (const [u, t] of Object.entries(options.charmap)) {
        map[u.normalize('NFC')] = map[u.normalize('NFD')] = t
      }
    }

    // Mark mappings that need a separator after a TeX control word.
    for (const v of Object.values(map)) {
      if (v.combining || v.text?.match(/\\[0-1a-z]+$/i)) v.macrospacer = true
    }

    this.map = map
  }

  /** Patterns whose output must stay grouped for bibtex creator's character counting. */
  private creatorBraces = [
    /[^{]\{/,
    /^\\[`\'~"=.][a-z]$/i,
    /^\\[\^]\\[ij]$/,
    /^\\[kr]\{[a-zA-Z]\}$/,
    /\\[0-1a-z]+$/i, // this prevents a spacer from producing \\l{}
  ]
  // https://github.com/retorquere/zotero-better-bibtex/issues/1189
  // Needed so that composite characters are counted as single characters
  // for in-text citation generation. This messes with the {} cleanup
  // so the resulting TeX will be more verbose; doing this only for
  // bibtex because biblatex doesn't appear to need it.
  //
  // Only testing .text because that's the only place (so far)
  // that these have turned up.
  /**
   * Apply creator-mode grouping or retain a marker for later control-word spacing.
   * @param mode - current TeX output mode: `text` or `math`
   * @param text - mapped TeX for one input unit
   * @param macrospacer - whether the mapping requires a separator after a control word
   * @returns grouped TeX or text with an internal spacing marker
   */
  private braceorspace(mode: Mode, text: string, macrospacer: boolean): string {
    // Preserve the argument group and add the outer group, for example \~{\^e} becomes {\~{\^e}}.
    if (mode === 'text' && text.match(/^\\[`\'^~"=.](?:\{.*\}|\\[a-z]+)$/i)) return `{${text}}`

    if (mode === 'text' && this.creator) {
      // These patterns identify TeX forms that bibtex creator must count as one unit.
      if (this.creatorBraces.find(re => text.match(re))) return `{${text}}`

      let m: RegExpMatchArray | null

      // Empty accent arguments count as a single character when wrapped as a group.
      if (m = text.match(/^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i)) return `{\\${m[1]}}`

      // Separate a one-character accent argument so bibtex creator counts it as one unit.
      if (m = text.match(/^\\([a-z])\{([a-z0-9])\}$/i)) return `{\\${m[1]} ${m[2]}}`

      // Group remaining composite TeX expressions unless already enclosed in braces.
      if (text.length > 2 && text.match(/[\\_^]/) && !text.match(/(^\{)|(\}$)/)) return `{${text}}`
    }

    return text + (macrospacer ? '\0' : '')
  }

  // ccc = combining character code(s)
  // Capture either the special tie sequence, a base plus combining character codes, or one character.
  private char = /(?<match>(?<tie>i\uFE20a\uFE21)|(?<combined>(?<base>[^\p{M}]?)(?<cccs>\p{M}+))|(?<single>.))/gu
  /**
   * Apply one combining mark to a mapped base, preferring explicit combined entries.
   * @param tc - current TeX mapping for the base or partially combined character
   * @param ccc - one combining character code to apply
   * @returns the updated mapping, or `null` when the mark cannot be represented
   */
  private apply(tc: TeXChar, ccc: string): TeXChar | null {
    let resolved: TeXChar
    // Prefer exact mappings for the complete text/math sequence over synthesized accents.
    if (tc.text && (resolved = this.map[`${tc.text}${ccc}`])) return resolved
    if (tc.math && (resolved = this.map[`${tc.math}${ccc}`])) return resolved

    // Otherwise use the combining-mark entry, which specifies its TeX macro and output mode.
    const tl = combining.tolatex[ccc]
    if (!tl) return null

    // Apply the entry only if the base mapping supports its output mode.
    const char = tc[tl.mode]
    if (!char) return null

    const isMacro = tl.macro.match(/[a-z]/i)
    // A bare TeX control word represents one character despite its string length.
    const isSingleChar = [...char].length === 1 || /^\\[a-z]+$/i.test(char)

    if (isMacro && isSingleChar) {
      return { [tl.mode]: `\\${tl.macro} ${char}` }
    }
    else if (isMacro || !isSingleChar) {
      return { [tl.mode]: `\\${tl.macro}{${char}}` }
    }
    else {
      return { [tl.mode]: `\\${tl.macro}${char}` }
    }
  }

  /**
   * Transform the given text to LaTeX
   *
   * @param text - the text to transform
   * @param options - math-bracing, spacer-preservation, and package-reporting options
   * The input is normalized to NFD before matching; the result is normalized to NFC.
   */
  tolatex(text: string, options: TranslateOptions = {}): string {
    const { bracemath, preservemacrospacers, packages } = {
      bracemath: false,
      preservemacrospacers: false,
      packages: new Set(),
      ...options,
    }
    // Output starts in text mode; each mapping may require switching modes.
    let mode: Mode = 'text'

    // Delimiters used when switching into each mode, optionally protected by braces.
    const switchTo = {
      math: (bracemath ? '{$' : '$'),
      text: (bracemath ? '$}' : '$'),
    } as const

    let mapped: TeXChar | null
    let switched: boolean
    let m: RegExpExecArray | RegExpMatchArray | null

    let latex = ''
    let tc: TeXChar | null
    for (const matchResult of text.normalize('NFD').matchAll(this.char)) {
      const groups = matchResult.groups
      if (!groups) continue

      const { match, tie, combined, base, cccs, single } = groups
      if (!match) continue
      const singleChar = single ?? ''

      // Minimal mode intentionally performs only direct per-character table lookups.
      if (this.minimal) {
        mapped = this.map[singleChar]
      }
      // The tie sequence has a readable fallback when no explicit tie mapping exists.
      else if (tie && !this.map[tie]) {
        mapped = { text: 'ia' }
      }
      // Exact full-sequence mappings take precedence over decomposing and composing marks.
      else if (tc = this.map[tie] || this.map[combined] || this.map[singleChar]) {
        mapped = tc
      }
      // For an unmapped base-plus-marks sequence, try mark orderings and partial combinations.
      else if (combined && base !== undefined && cccs !== undefined) {
        // CCCs are the captured combining-mark characters; permutations handle order-sensitive recipes.
        let CCCs = [...cccs]
        // Consume the longest prefix that can be mapped, leaving remaining marks for sequential application.
        const basetc = this.map[base] || { text: base, math: base }
        const permutations = allPermutations(CCCs)
        ;[mapped, CCCs] = Array.from({ length: CCCs.length + 1 }, (_, i) => CCCs.length - i)
          .reduce<[TeXChar, string[]] | null>((acc, l) => {
            if (acc) return acc
            for (const p of permutations) {
              if (tc = this.apply(basetc, p.slice(0, l).join(''))) return [tc, p.slice(l)]
            }
            return null
          }, null) as [TeXChar, string[]]
          || [basetc, CCCs]

        for (const ccc of CCCs) {
          if (!(mapped = this.apply(mapped, ccc))) break
        }
      }
      else {
        // No known mapping path applies; preserve the original matched input below.
        mapped = null
      }

      // Preserve unsupported characters verbatim rather than dropping them.
      if (!mapped) mapped = { text: match }

      // in and out of math mode
      if (!mapped[mode]) {
        // A mapping absent from the current mode requires switching before appending it.
        mode = switchMode[mode]
        latex += switchTo[mode]
        switched = true
      }
      else {
        switched = false
      }

      // if we just switched out of math mode, and there's a lone sup/sub at the end, unpack it.
      // The extra option brace is for when we're not in bracemath mode (see switchTo)
      // This undo is limited to a trailing single-character script to keep ordinary groups intact.
      if (switched && mode === 'text' && (m = latex.match(/([\^_])\{(.)\}(\$\}?)$/))) {
        latex = latex.slice(0, latex.length - m[0].length) + m[1] + m[2] + m[3]
      }

      // macrospacer \0 clean up below
      const mappedText = mapped[mode]
      // A mapping may have no representation in the final active mode; skip that unit.
      if (!mappedText) continue
      latex += this.braceorspace(mode, mappedText, !!mapped.macrospacer)

      // only try to merge sup/sub if we were already in math mode, because if we were previously in text mode, testing for _^ is tricky.
      // Merge adjacent scripts only when no mode transition makes their grouping ambiguous.
      if (!switched && mode === 'math' && (m = latex.match(/(([\^_])\{[^{}]+)\}\2{(.\})$/))) {
        latex = latex.slice(0, latex.length - m[0].length) + m[1] + m[3]
      }

      if (mapped.alt) {
        // Report packages required for the selected alternate mapping to the caller.
        for (const pkg of mapped.alt) {
          packages.add(pkg)
        }
      }
    }

    // might still be in math mode at the end
    if (mode === 'math') latex += switchTo.text

    if (!preservemacrospacers) latex = replace_macro_spacers(latex)
    return latex.normalize('NFC')
  }
}
