export type TeXChar = { math?: string, text?: string, commandspacer?: boolean }
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

export type Options = {
  packages?: string[]
  math?: string
  text?: string
  ascii?: string
  charmap?: CharMap
}

export function load(mode : 'bibtex' | 'biblatex' | 'minimal',  options?: Options): CharMap {
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
