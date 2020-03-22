export declare const ascii: Record<string, { text?: string; math?: string; space?: boolean; packages: string[]; }>
export declare const unicode: Record<string, { text?: string; math?: string; space?: boolean; packages: string[]; }>
export declare const latex: Record<string, string>
export declare const diacritics: {
  commands: string[],
  tolatex: Record<string, { mode: 'math' | 'text', command: string}>
  tounicode: Record<string, string>
}
