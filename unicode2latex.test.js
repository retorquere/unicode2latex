#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires, no-console */

const { Transform } = require('./index')

function tx(input, expected) {
  if (typeof input === 'string') input = { text: input }
  if (typeof expected === 'string') expected = { latex: expected }
  const _tx = new Transform(input.mode || 'biblatex', { packages: input.pkgs || [] })
  const packages = new Set
  expect(_tx.tolatex(input.text, { prefer: input.prefer || '', packages })).toBe(expected.latex)
  expect([...packages].sort().join(',')).toBe(expected.pkgs || '')
}

test('macro spacer', () => {
  tx("On Recovery of Sparse Signals via ££p Minimization", "On Recovery of Sparse Signals via \\pounds\\pounds p Minimization")
})

test("Protokolle zu Drogenversuchen. Hauptz\u00fcge der ersten Haschisch-Impression", () => {
  tx("Protokolle zu Drogenversuchen. Hauptz\u00fcge der ersten Haschisch-Impression", "Protokolle zu Drogenversuchen. Hauptz\\\"uge der ersten Haschisch-Impression")
})

test("Planung o\u0308ffentlicher Elektrizit\u00e4tsverteilungs-Systeme", () => {
  tx("Planung o\u0308ffentlicher Elektrizit\u00e4tsverteilungs-Systeme", "Planung \\\"offentlicher Elektrizit\\\"atsverteilungs-Systeme")
})

test("Giga Bari\u0107eva. Roman iz zagreba\u010dkog poslijeratnog \u017eivota", () => {
  tx("Giga Bari\u0107eva. Roman iz zagreba\u010dkog poslijeratnog \u017eivota", "Giga Bari\\'ceva. Roman iz zagreba\\v ckog poslijeratnog \\v zivota")
})

test("En ny sociologi for et nyt samfund. Introduktion til Akt\u00f8r-Netv\u00e6rk-Teori", () => {
  tx("En ny sociologi for et nyt samfund. Introduktion til Akt\u00f8r-Netv\u00e6rk-Teori", "En ny sociologi for et nyt samfund. Introduktion til Akt\\o r-Netv\\ae rk-Teori")
})

test("La d\u00e9mocratie. Sa nature, sa valeur", () => {
  tx("La d\u00e9mocratie. Sa nature, sa valeur", "La d\\'emocratie. Sa nature, sa valeur")
})

test("Overall Normalization of the Astrophysical \u2192 Reactions", () => {
  tx("Overall Normalization of the Astrophysical \u2192 Reactions", { latex: "Overall Normalization of the Astrophysical $\\rightarrow$ Reactions", pkgs: "textcomp" })
})

test("\u00a7 1063 ABGB", () => {
  tx("\u00a7 1063 ABGB", "\\S{} 1063 ABGB")
})

test("Die Sicherungs\u00fcbereignung", () => {
  tx("Die Sicherungs\u00fcbereignung", 'Die Sicherungs\\"ubereignung')
})

test("Entscheidung nach \u00a7 98 EheG und anh\u00e4ngiges Verfahren", () => {
  tx("Entscheidung nach \u00a7 98 EheG und anh\u00e4ngiges Verfahren", "Entscheidung nach \\S{} 98 EheG und anh\\\"angiges Verfahren")
})

test("Object-based attentional selection\u2013grouped arrays or spatially invariant representations?: comment on vecera and Farah (1994).", () => {
  tx("Object-based attentional selection\u2013grouped arrays or spatially invariant representations?: comment on vecera and Farah (1994).", "Object-based attentional selection--grouped arrays or spatially invariant representations?: comment on vecera and Farah (1994).")
})

test("De l\u2019asynergie cerebelleuse", () => {
  tx("De l\u2019asynergie cerebelleuse", "De l'asynergie cerebelleuse")
})

test("Representational similarity analysis \u2013 connecting the branches of systems neuroscience.", () => {
  tx("Representational similarity analysis \u2013 connecting the branches of systems neuroscience.", "Representational similarity analysis -- connecting the branches of systems neuroscience.")
})

test("Infants\u2019 brain responses to speech suggest analysis by synthesis", () => {
  tx("Infants\u2019 brain responses to speech suggest analysis by synthesis", "Infants' brain responses to speech suggest analysis by synthesis")
})

test("B\u00fcrgerliches Recht Band I Allgemeiner Teil", () => {
  tx("B\u00fcrgerliches Recht Band I Allgemeiner Teil", 'B\\"urgerliches Recht Band I Allgemeiner Teil')
})

// test("math: 0 < p < 1", () => {
//   tx({ text: "0 < p < 1", prefer: 'math' }, "$0 < p < 1$")
// })

test("non-breaking space: ; accented characters: \u00f1 and \u00f1; tilde in URL: http://example.com/~user", () => {
  tx({ text: "non-breaking space: ; accented characters: \u00f1 and \u00f1; tilde in URL: http://example.com/~user", mode: "minimal" }, "non-breaking space: ; accented characters: ñ and ñ; tilde in URL: http://example.com/\\textasciitilde user")
})

test("Munaf\u0102\u02db", () => {
  tx({ text: "Munaf\u0102\u02db", mode: 'bibtex' }, "Munaf{\\u A}{\\k{}}")
})

test("Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$", () => {
  tx(
    { text: "Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$", mode: 'bibtex' },
    "Molecular Theory of Atomic Collisions: Calculated Cross Sections for \\$\\{{\\textbackslash}mathrm\\{H\\}\\}{\\textasciicircum}\\{+{\\textbackslash}\\}\\vphantom\\{\\}+{\\textbackslash}mathrm\\{F\\}({\\textasciicircum}\\{2\\}P)\\$"
  )
})

test("Pető", () => {
  tx("Pető", "Pet\\H o")
})

test("K̅", () => {
  tx("K̅", "$\\overline K$")
})

test("Lema\u00eetre", () => {
  tx("Lema\u00eetre", "Lema\\^itre")
})

test("2 > 1", () => {
  tx("2 > 1", "2 $>$ 1")
})

test("CJK quotes unchanged", () => {
  tx({ text: "\u201c\u6c11\u65cf\u56fd\u5bb6\u201d\u7684\u8ff7\u601d\u4e0e\u73b0\u4ee3\u4e2d\u56fd\u7684\u5f62\u6210", mode: "minimal" }, "\u201c\u6c11\u65cf\u56fd\u5bb6\u201d\u7684\u8ff7\u601d\u4e0e\u73b0\u4ee3\u4e2d\u56fd\u7684\u5f62\u6210")
})
