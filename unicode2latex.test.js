#!/usr/bin/env node

const { Transform } = require('./dist/cjs/index')

test('macro spacer', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('On Recovery of Sparse Signals via ££p Minimization'))
    .toBe('On Recovery of Sparse Signals via \\pounds\\pounds p Minimization')
})

test('Protokolle zu Drogenversuchen. Hauptz\u00fcge der ersten Haschisch-Impression', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Protokolle zu Drogenversuchen. Hauptz\u00fcge der ersten Haschisch-Impression'))
    .toBe('Protokolle zu Drogenversuchen. Hauptz\\"uge der ersten Haschisch-Impression')
})

test('Planung o\u0308ffentlicher Elektrizit\u00e4tsverteilungs-Systeme', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Planung o\u0308ffentlicher Elektrizit\u00e4tsverteilungs-Systeme'))
    .toBe('Planung \\"offentlicher Elektrizit\\"atsverteilungs-Systeme')
})

test('Giga Bari\u0107eva. Roman iz zagreba\u010dkog poslijeratnog \u017eivota', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Giga Bari\u0107eva. Roman iz zagreba\u010dkog poslijeratnog \u017eivota'))
    .toBe("Giga Bari\\'ceva. Roman iz zagreba\\v ckog poslijeratnog \\v zivota")
})

test('En ny sociologi for et nyt samfund. Introduktion til Akt\u00f8r-Netv\u00e6rk-Teori', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('En ny sociologi for et nyt samfund. Introduktion til Akt\u00f8r-Netv\u00e6rk-Teori'))
    .toBe('En ny sociologi for et nyt samfund. Introduktion til Akt\\o r-Netv\\ae rk-Teori')
})

test('La d\u00e9mocratie. Sa nature, sa valeur', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('La d\u00e9mocratie. Sa nature, sa valeur'))
    .toBe("La d\\'emocratie. Sa nature, sa valeur")
})

test('Overall Normalization of the Astrophysical \u2192 Reactions', () => {
  const tx = new Transform('biblatex')
  const packages = new Set()
  expect(tx.tolatex('Overall Normalization of the Astrophysical \u2192 Reactions', { packages }))
    .toBe('Overall Normalization of the Astrophysical $\\rightarrow$ Reactions')
  expect([...packages].sort().join(',')).toBe('textcomp')
})

test('\u00a7 1063 ABGB', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('\u00a7 1063 ABGB'))
    .toBe('\\S{} 1063 ABGB')
})

test('Die Sicherungs\u00fcbereignung', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Die Sicherungs\u00fcbereignung'))
    .toBe('Die Sicherungs\\"ubereignung')
})

test('Entscheidung nach \u00a7 98 EheG und anh\u00e4ngiges Verfahren', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Entscheidung nach \u00a7 98 EheG und anh\u00e4ngiges Verfahren'))
    .toBe('Entscheidung nach \\S{} 98 EheG und anh\\"angiges Verfahren')
})

test('Object-based attentional selection\u2013grouped arrays or spatially invariant representations?: comment on vecera and Farah (1994).', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex(
    'Object-based attentional selection\u2013grouped arrays or spatially invariant representations?: '
      + 'comment on vecera and Farah (1994).',
  ))
    .toBe(
      'Object-based attentional selection--grouped arrays or spatially invariant representations?: '
        + 'comment on vecera and Farah (1994).',
    )
})

test('De l\u2019asynergie cerebelleuse', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('De l\u2019asynergie cerebelleuse')).toBe("De l'asynergie cerebelleuse")
})

test('Representational similarity analysis \u2013 connecting the branches of systems neuroscience.', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Representational similarity analysis \u2013 connecting the branches of systems neuroscience.'))
    .toBe('Representational similarity analysis -- connecting the branches of systems neuroscience.')
})

test('Infants\u2019 brain responses to speech suggest analysis by synthesis', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Infants\u2019 brain responses to speech suggest analysis by synthesis'))
    .toBe("Infants' brain responses to speech suggest analysis by synthesis")
})

test('B\u00fcrgerliches Recht Band I Allgemeiner Teil', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('B\u00fcrgerliches Recht Band I Allgemeiner Teil'))
    .toBe('B\\"urgerliches Recht Band I Allgemeiner Teil')
})

// test("math: 0 < p < 1", () => {
//   tx({ text: "0 < p < 1", prefer: 'math' }, "$0 < p < 1$")
// })

test('non-breaking space: ; accented characters: \u00f1 and \u00f1; tilde in URL: http://example.com/~user', () => {
  const tx = new Transform('minimal')
  expect(tx.tolatex('non-breaking space: ; accented characters: \u00f1 and \u00f1; tilde in URL: http://example.com/~user'))
    .toBe('non-breaking space: ; accented characters: ñ and ñ; tilde in URL: http://example.com/\\textasciitilde user')
})

test('ogonek in bibtex-creator Munaf\u0102\u02db', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('ogonek in bibtex-creator Munaf\u0102\u02db'))
    .toBe('ogonek in bibtex-creator Munaf{\\u A}{\\k{}}')
})
test('ogonek in bibtex Munaf\u0102\u02db', () => {
  const tx = new Transform('bibtex')
  expect(tx.tolatex('ogonek in bibtex Munaf\u0102\u02db'))
    .toBe('ogonek in bibtex Munaf\\u A\\k{}')
})

test('Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$', () => {
  const tx = new Transform('bibtex')
  expect(tx.tolatex('Molecular Theory of Atomic Collisions: Calculated Cross Sections for ${\\mathrm{H}}^{+\\}}+\\mathrm{F}(^{2}P)$'))
    .toBe('Molecular Theory of Atomic Collisions: Calculated Cross Sections for \\$\\textbraceleft\\textbackslash mathrm\\textbraceleft H\\textbraceright\\textbraceright\\textasciicircum\\textbraceleft +\\textbackslash\\textbraceright\\textbraceright +\\textbackslash mathrm\\textbraceleft F\\textbraceright (\\textasciicircum\\textbraceleft 2\\textbraceright P)\\$')
})

test('Pető', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Pető')).toBe('Pet\\H o')
})

test('K̅', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('K̅')).toBe('$\\overline K$')
})

test('Lema\u00eetre', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('Lema\u00eetre')).toBe('Lema\\^itre')
})

test('2 > 1', () => {
  const tx = new Transform('biblatex')
  expect(tx.tolatex('2 > 1')).toBe('2 $>$ 1')
})

test('CJK quotes unchanged', () => {
  const tx = new Transform('minimal')
  expect(tx.tolatex('\u201c\u6c11\u65cf\u56fd\u5bb6\u201d\u7684\u8ff7\u601d\u4e0e\u73b0\u4ee3\u4e2d\u56fd\u7684\u5f62\u6210'))
    .toBe('\u201c\u6c11\u65cf\u56fd\u5bb6\u201d\u7684\u8ff7\u601d\u4e0e\u73b0\u4ee3\u4e2d\u56fd\u7684\u5f62\u6210')
})

test('{Rafael', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('{Rafael')).toBe('{\\textbraceleft}Rafael')
})
test('Pérez}', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('Pérez}')).toBe("P{\\'e}rez{\\textbraceright}")
})
test('Pérez}, {Rafael', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('Pérez}, {Rafael')).toBe("P{\\'e}rez{\\textbraceright}, {\\textbraceleft}Rafael")
})

test('Francisco Perdig\u00f3n', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('bibtex-creator Francisco Perdig\u00f3n')).toBe("bibtex-creator Francisco Perdig{\\'o}n")
})
test('Francisco Perdig\u00f3n', () => {
  const tx = new Transform('bibtex')
  expect(tx.tolatex('bibtex Francisco Perdig\u00f3n')).toBe("bibtex Francisco Perdig\\'on")
})

test('Michał', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('Michał MichałMichał')).toBe('Micha\\l{} Micha\\l Micha\\l')
})

test('Paı̈doussis', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('Paı̈doussis')).toBe('Pa{\\"\\i}doussis')
})

test('Oxenløwe', () => {
  const tx = new Transform('bibtex-creator')
  expect(tx.tolatex('Oxenløwe')).toBe('Oxenl\\o we')
})
