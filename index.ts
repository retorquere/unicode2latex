export type CharMap = Record<string, { math?: string, text?: string, commandspacer?: boolean }>
export type TeXMap = {
  base: CharMap
  package: Record<string, CharMap>
  provides: Record<string, string>
  stopgap: string
}

export const biblatex: TeXMap = require('./tables/biblatex.json')
export const bibtex: TeXMap = require('./tables/bibtex.json')
export const minimal: TeXMap = require('./tables/minimal.json')

const maps = { biblatex, bibtex }

export const latex2unicode: Record<string, string> = require('./tables/latex2unicode.json')

export const diacritics: {
  commands: string[],
  tolatex: Record<string, {command: string, mode: 'text' | 'math'}>,
  tounicode: Record<string, string>
} = require('./tables/diacritics.json')

export type Options = {
  packages?: string[]
  math?: string
  text?: string
}

export function load(mode : 'bibtex' | 'biblatex',  options?: Options): CharMap {
  let map = { ...maps[mode].base }
  for (const pkg of (options.packages || []).map(p => map.packages[p]).filter(p => p)) {
    map = { ...map, ...pkg }
  }
  for (const c of (options.text || '')) {
    if (map[c].text) delete map[c].math
  }
  for (const c of (options.math || '')) {
    if (map[c].math) delete map[c].text
  }
  return map
}
