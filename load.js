#!/usr/bin/env node

const csv = require('papaparse')
const fs = require('fs')

const hex = (n) => '\\u' + ('0000' + n.toString(16)).slice(-4)
const re = /([\uD800-\uDBFF][\uDC00-\uDFFF])|([^ -~\n\r])/g
function asciify(char, pair, single) {
  if (pair) return hex(pair.charCodeAt(0)) + hex(pair.charCodeAt(1))
  if (single) return hex(single.charCodeAt(0))
  return char
}
function ascii(s) {
  return s.replace(re, asciify)
}

function permutations(v) {
  function p(prefix, s, acc) {
    acc = acc || []
    var n = s.length
    if (n === 0) return acc.push(prefix)
    for (var i = 0; i < n; i++) {
      p(prefix + s.charAt(i), s.substring(0, i) + s.substring(i+1), acc)
    }
    return acc
  }

  return p('', v)
}

function tojson(obj) {
  return ascii(JSON.stringify(obj, null, 2))
}

function duplicate(stanza) {
  stanza.unicode = stanza.unicode.normalize('NFD')
  return [ stanza ]
  /*
  if (`${stanza.unicode}${stanza.unicode}` === `${stanza.unicode.normalize('NFC')}${stanza.unicode.normalize('NFD')}` ) return [ stanza ]
  console.log('duplicating', stanza.tex)
  const nfc = Object.create(stanza)
  nfc.unicode = nfc.unicode.normalize('NFC')
  const nfd = Object.create(stanza)
  nfd.unicode = nfd.unicode.normalize('NFD')
  return [ nfc, nfd ]
  */
}

class Mapping {
  constructor(stanza) {
    this.unicode = stanza.shift()
    this.conversion = {'<': 't2u', '>': 'u2t', '=': '='}[stanza.shift()]
    if (!this.conversion) throw new Error('unexpected conversion')
    this.tex = stanza.shift()
    this.mode = ''
    this.package = ''
    this.flag = {}

    let m
    for (const op of stanza) {
      if (m = op.match(/^(math|text)(?:[.]([-a-zA-Z]+))?$/)) {
        this.mode = m[1]
        this.package = m[2] || ''
      }
      else if (['stopgap', 'combining', 'space'].includes(op)) {
        this.flag[op] = true
      }
      else {
        throw new Error(op)
      }
    }

    if (this.flag.combining && this.unicode.normalize('NFD').length > 2) throw new Error('update translator')

    if ((this.mode == 'text' || this.mode == '') && this.tex.match(/\\[0-1A-Za-z]+$/)) this.flag.commandspacer = true

    if (this.flag.stopgap && this.conversion === '=') throw new Error('sus conversion')

  }

  get u2t() {
    return this.conversion == 'u2t' || this.conversion == '='
  }
  get t2u() {
    return this.conversion == 't2u' || this.conversion == '='
  }
}
const TeXMap = csv.parse(fs.readFileSync('config.ssv', 'utf-8'), { delimiter: ' ', quoteChar: '@' })
  .data
  .filter(row => row.join('') !== '' && row[0] != '##')
  .map(stanza => duplicate(new Mapping(stanza)))
  .flat(Infinity)

class Diacritics {
  constructor() {
    const commands = new Set
    this.tolatex = {}
    this.tounicode = {}

    let m
    // the sort will handle text after math so that text gets precedence
    for (const c of TeXMap.sort((a, b) => a.mode.localeCompare(b.mode))) {
      if (!c.flag.combining) continue

      if (m = c.tex.match(/^\\([a-z]+)$/)) commands.add(m[1])
      if (c.tex[0] === '\\') {
        const cmd = c.tex.substr(1).replace('{}', '')
        this.tounicode[cmd] = c.unicode

        // the permutation is because multi-diacritics like `textgravemacron` can be applied in any order in unicode
        for (const cd of permutations(c.unicode)) {
          this.tolatex[cd] = { mode: c.mode, command: cmd }
        }
      }
    }
    this.commands = [...commands].sort()
  }
  
  save(filename) {
    fs.writeFileSync(filename, tojson({ commands: this.commands, tolatex: this.tolatex, tounicode: this.tounicode }))
  }
}

new Diacritics().save('tables/diacritics.json')

class U2T {
  constructor(mode) {
    const escape = re => re.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const minimal = new RegExp(`^(${[
      '\u00A0',
      '\u180E',
      '\u2000',
      '\u2001',
      '\u2002',
      '\u2003',
      '\u2004',
      '\u2005',
      '\u2006',
      '\u2007',
      '\u2008',
      '\u2009',
      '\u200A',
      '\u200B',
      '\u202F',
      '\u205F',
      '\u3000',
      '\uFEFF',
      '<',
      '>',
      '\\',
      '#',
      '$',
      '%',
      '&',
      '^',
      '_',
      '{',
      '}',
      '~',
      ']',
      '/\u200b',
    ].map(escape).join('|')})$`)

    this.base = {}
    this.package = {}
    const alts = {}
  
    /*
    https://github.com/retorquere/zotero-better-bibtex/issues/1189
    Needed so that composite characters are counted as single characters
    for in-text citation generation. This messes with the {} cleanup
    so the resulting TeX will be more verbose; doing this only for
    bibtex because biblatex doesn't appear to need it.
   
    Only testing ascii.text because that's the only place (so far)
    that these have turned up.
    https://github.com/retorquere/zotero-better-bibtex/issues/1538
    Further workarounds because bibtex inserts an NBSP for \o{}x in author names, which is insane, but that's bibtex for ya
    */
    /* ??
      if re.match(r'^[a-zA-Z]$', marker):
        diacritic_re.append(re.escape(marker) + r'[^a-zA-Z]')
        diacritic_re.append(re.escape(marker) + r'$')
    */
    const cd = new RegExp(
      escape('\\')
      +
      '('
      +
      TeXMap.filter(c => c.u2t && c.flag.combining && c.tex.match(/^\\.$/)).map(c => c.tex[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      +
      ')'
    )

    const bibtex = (c, m) => {
      const commandspacer = m.commandspacer
      delete m.commandspacer

      if (commandspacer) return (m.text = `{${m.text}}`) // See #1538.

      if (m.text.match(/^\\[`\'^~"=.][A-Za-z]$/) || m.text.match(/^\\[\^]\\[ij]$/) || m.text.match(/^\\[kr]\{[a-zA-Z]\}$/)) return (m.text = `{${m.text}}`)

      let r
      if (r = m.text.match(/^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i)) return (m.text = `{\\${r[1]}}`)
      if (r = m.text.match(/^\\([a-z])\{([a-z0-9])\}$/i)) return (m.text = `{\\${r[1]} ${r[2]}}`)

      if (!c.flag.combining && !m.text.match(/^[{].*[}]$/) && cd.test(m.text)) return (m.text = `{${m.text}}`)

      if (m.text.match(/.*\\[0-1a-z]+$/i) && !c.flag.combining) m.commandspacer = true
    }

    const setmode = (c, m) => {
      // currently have a stopgap, but we have a good replacement
      if (m.stopgap && !c.flag.stopgap) {
        delete m.stopgap
        delete m.commandspacer
        delete m.math
        delete m.text
      }
      for (const cmode of (c.mode === '' ? [ 'math', 'text'] : [ c.mode ])) {
        if ((m.text || m.math) && c.flag.stopgap) continue // already have least as good option
        m[cmode] = c.tex
        if (c.flag.stopgap) m.stopgap = true
        if (c.flag.commandspacer) m.commandspacer = true

        if (mode === 'bibtex' && cmode === 'text') bibtex(c, m)
      }
    }

    for (const c of TeXMap) {
      if (!c.u2t) continue

      if (mode === 'minimal' && ! c.unicode.match(minimal)) continue
      if (mode === 'minimal' && c.package != '') throw c

      if (c.package === '') {
        const b = this.base[c.unicode] || { }
        setmode(c, b)
        if (mode === 'biblatex' || mode === 'bibtex') {
          b.alt = [...(new Set(TeXMap.filter(alt => alt.u2t && alt.unicode === c.unicode && alt.package != '').map(alt => alt.package)))].sort()
          if (!b.alt.length) delete b.alt
        }
        this.base[c.unicode] = b
      }
      else {
        alts[c.unicode] = c.package
        this.package[c.package] = this.package[c.package] || {}
        const p = this.package[c.package][c.unicode] || {}
        setmode(c, p)
        this.package[c.package][c.unicode] = p
      }
    }

    for (const t of Object.values(this.base)) {
      delete t.stopgap
    }
  }

  save(filename) {
    console.log(Object.keys(this.package).sort().map(pkg => '`' + pkg + '`').join(', '))
    fs.writeFileSync(filename, tojson({ base: this.base, package: this.package }))
  }
}

new U2T('biblatex').save('tables/biblatex.json')
new U2T('bibtex').save('tables/bibtex.json')
new U2T('minimal').save('tables/minimal.json')

class T2U {
  constructor() {
    this.mapping = {}
    for (const c of TeXMap) {
      if (!c.t2u) continue
      this.mapping[c.tex] = c.unicode
    }
  }

  save(filename) {
    fs.writeFileSync(filename, tojson(this.mapping))
  }
}

new T2U().save('tables/latex2unicode.json')
