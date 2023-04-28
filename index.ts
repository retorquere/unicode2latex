export type TeXMap = {
  text?: string
  textpackages?: string[],
  math?: string
  mathpackages?: string[],
  space?: boolean,
  combiningdiacritic?: boolean,
}
export const ascii: TeXMap = require('./tables/ascii.json')
export const ascii_bibtex_creator: TeXMap = require('./tables/ascii-bibtex-creator.json')
export const unicode: TeXMap = require('./tables/unicode.json')

export const latex: Record<string, string> = require('./tables/latex.json')

export const diacritics: { commands: string[], tolatex: Record<string, {command: string, mode: 'text' | 'math'}>, tounicode: Record<string, string> } = require('./tables/diacritics.json')
