#!/usr/bin/env python3

import json
import sqlite3
import re
import os

class TableJSONEncoder(json.JSONEncoder):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    self.indent = ''

  def encode(self, o):
    if isinstance(o, dict):
      indent = '  '
      members = [f'{indent}{json.dumps(k)}: {json.dumps(v)}' for k, v in o.items()]
      return '{\n' + ',\n'.join(members) + '\n}'
    else:
      return json.dumps(o)

class ConfigJSONEncoder(json.JSONEncoder):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    self.indent = ''

  def encode(self, o):
    if isinstance(o, tuple):
      return "[ " + ", ".join(json.dumps(el) for el in o) + " ]"
    elif isinstance(o, list):
      self.indent += '  '
      output = [self.indent + self.encode(el) for el in o]
      self.indent = self.indent[:-2]
      output = '[\n' + ',\n'.join(output) + '\n' + self.indent + ']'
      return output
    else:
      return json.dumps(o)

class Config:
  def __init__(self):
    self.tuples = []

    self.db = sqlite3.connect(':memory:')
    self.db.execute('''
      CREATE TABLE build (
        unicode NOT NULL,
        relation TEXT CHECK (relation IN ('unicode-to-math', 'unicode-to-text', 'tex-to-unicode')),
        latex NOT NULL,
        isspace CHECK (isspace in (0, 1)),
        package CHECK ((relation = 'tex-to-unicode' AND package IS NULL) OR relation <> 'tex-to-unicode')
      )
    ''')

    self.db.execute('''
      CREATE TRIGGER consistency BEFORE INSERT ON build
        BEGIN
          SELECT RAISE(ABORT, 'duplicate unicode-to-latex')
          WHERE EXISTS (
            SELECT 1 FROM build WHERE relation = NEW.relation AND relation in ('unicode-to-math', 'unicode-to-text') AND unicode = NEW.unicode AND latex <> NEW.latex
          );

          -- test latex -> unicode
          SELECT RAISE(ABORT, 'duplicate tex-to-unicode')
          WHERE EXISTS (
            SELECT 1 FROM build WHERE relation = NEW.relation AND relation = 'tex-to-unicode' AND latex = NEW.latex AND unicode <> NEW.unicode
          );
        END
    ''')

  def meta(self, latex):
    assert type(latex) == str
    packages = []
    isspace = False

    for pkg, sp in self.db.execute('SELECT package, isspace FROM tuples WHERE latex = ?', [latex]):
      if pkg: packages += [ p for p in re.split(r'[ ,]', pkg) if p != '' ]
      isspace = isspace or (sp == 1)

    if len(packages) == 0 and not isspace: return None

    m = {}
    if len(packages) > 0:
      m['packages'] = ' '.join(sorted(list(set(packages))))
    if isspace:
      m['space'] = True
    return m

  def add(self, relation, ucode, latex):
    if relation.startswith('unicode-'):
      m = self.meta(latex)
      if m:
        self.tuples.append((ucode, relation, latex, m))
      else:
        self.tuples.append((ucode, relation, latex))
    else:
      self.tuples.append((latex, relation, ucode))

  def compact(self):
    bidi = '''
      SELECT u.unicode, u.relation, u.latex
      FROM tuples u
      JOIN tuples l ON
        u.unicode = l.unicode AND u.latex = l.latex
        AND u.relation <> l.relation
        AND u.relation IN ('unicode-to-math', 'unicode-to-text')
        AND l.relation = 'tex-to-unicode'
    '''
    for row in list(self.db.execute(bidi)):
      ucode, relation, latex = row
      self.add(relation.replace('-to-', '-is-'), ucode, latex)
      self.db.execute('DELETE FROM tuples WHERE unicode = ? AND relation = ? AND latex = ?', row)
      self.db.execute("DELETE FROM tuples WHERE unicode = ? AND relation = 'tex-to-unicode' AND latex = ?", [row[0], row[2]])

    math_text = '''
      SELECT t.unicode, t.latex
      FROM tuples t
      JOIN tuples m ON
        t.unicode = m.unicode AND t.latex = m.latex
        AND t.relation = 'unicode-to-text'
        AND m.relation = 'unicode-to-math'
    '''
    for row in list(self.db.execute(math_text)):
      ucode, latex = row
      self.add('unicode-to-tex', ucode, latex)
      self.db.execute("DELETE FROM tuples WHERE unicode = ? AND latex = ? AND relation IN ('unicode-to-math', 'unicode-to-text')", row)

    for row in self.db.execute("SELECT DISTINCT relation, unicode FROM tuples WHERE relation = 'tex-to-unicode'"):
      relation, ucode = row
      latex = [tex[0] for tex in self.db.execute("SELECT latex FROM tuples WHERE relation = ? AND unicode = ? ORDER BY latex", row)]
      if len(latex) == 1: latex = latex[0]
      self.add(relation, ucode, latex)

    for mode in ['math', 'text']:
      for row in self.db.execute(f"SELECT DISTINCT relation, latex FROM tuples WHERE relation = 'unicode-to-{mode}'"):
        relation, latex = row
        ucodes = [ucode[0] for ucode in self.db.execute(f"SELECT unicode FROM tuples WHERE relation = ? AND latex = ? ORDER BY unicode", row)]
        if len(ucodes) == 1: ucodes = ucodes[0]
        self.add(relation, ucodes, latex)

  def save(self):
    table = {}
    for ucode, relation, latex, package, isspace in self.db.execute("SELECT unicode, relation, latex, package, isspace FROM tuples WHERE relation LIKE 'unicode-to-%' ORDER BY unicode ASC, relation DESC"):
      table[ucode] = table.get(ucode, {})
      table[ucode][relation.replace('unicode-to-', '')] = latex
    for ucode, relation, latex, package, isspace in self.db.execute("SELECT unicode, relation, latex, package, isspace FROM tuples WHERE relation LIKE 'unicode-to-%' ORDER BY unicode ASC, relation DESC"):
      if isspace == 1: table[ucode]['space'] = True
      if package: table[ucode]['package'] = package
    with open ('tables/ascii.json', 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)
    for ucode in list(table.keys()):
      if ucode not in '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF<>\\#$%&^_{}~':
        del table[ucode]
    with open ('tables/unicode.json', 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    table = {}
    for latex, relation, ucode in self.db.execute("SELECT latex, relation, unicode FROM tuples WHERE relation = 'tex-to-unicode' ORDER BY unicode"):
      table[latex] = ucode
    with open ('tables/latex.json', 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    self.compact()

    def key(tup):
      if tup[1] == 'tex-to-unicode':
        ucode = tup[2]
      else:
        ucode = tup[0]
      if type(ucode) == list: ucode = ucode[0]
      return ucode
    tuples = sorted(self.tuples, key=key)
    with open('tables/config.json', 'w') as f:
      print(json.dumps(tuples, ensure_ascii=True, cls=ConfigJSONEncoder), file=f)

class Legacy(Config):
  def __init__(self):
    super().__init__()

    with open('tables/legacy.json') as f:
      table = json.load(f)

    for ucode, latex in table.items():
      for key in latex.keys():
        if key not in ['space', 'math', 'text', 'alttext', 'altmath', 'dupmath', 'duptext', 'textpackage', 'mathpackage', 'package']:
          raise ValueError(key)

      isspace = 1 if 'space' in latex else 0
      for mode in ['text', 'math']:
        if mode in latex:
          self.db.execute('INSERT INTO build (unicode, relation, latex, package, isspace) VALUES (?, ?, ?, ?, ?)', [ucode, f'unicode-to-{mode}', latex[mode], latex.get(f'{mode}package', latex.get('package')), isspace ])
          if not f'dup{mode}' in latex:
            if re.search('[\\{_^]', latex[mode]):
              try:
                self.db.execute('INSERT INTO build (latex, relation, unicode, package, isspace) VALUES (?, ?, ?, ?, ?)', [latex[mode], f'tex-to-unicode', ucode, None, isspace ])
              except:
                print([latex[mode], f'tex-to-unicode', ucode, None, isspace ])
                raise

        if f'alt{mode}' in latex:
          for tex in latex[f'alt{mode}']:
            self.db.execute('INSERT INTO build (latex, relation, unicode, package, isspace) VALUES (?, ?, ?, ?, ?)', [tex, f'tex-to-unicode', ucode, None, isspace ])

    manual = [
      ('\\', '\\'),
      ('\\textmu{}', '\u03BC'),
      ('\\to{}', '\u2192'),
      ('\\varGamma{}', '\u0393'),
      ('\\ocirc{u}', '\u016F'),
      ('\\textless{}', '<'),
      ('\\textgreater{}', '>'),
      ('{\\~ w}', 'w\u0303'),
      ('\\textasciitilde{}', '~'),
      ('\\LaTeX{}', 'LaTeX'),
      ('{\\c e}', '\u1E1D'),
      ('\\neg{}', '\u00ac'),
      ('\\Box{}', '\u25a1'),
      ('\\le{}', '\u2264'),
      ("\\'\\i", '\u00ED')
    ]
    for latex, ucode in manual:
      self.db.execute('INSERT INTO build (latex, relation, unicode, package, isspace) VALUES (?, ?, ?, ?, ?)', [latex, f'tex-to-unicode', ucode, None, 0 ])

    self.db.execute('CREATE TABLE tuples AS SELECT DISTINCT * FROM build')

    self.db.commit()

class Tuples(Config):
  def __init__(self):
    super().__init__()

    with open('tables/config.json') as f:
      table = json.load(f)

    for rel in table:
      try:
        meta = rel[3]
      except:
        meta = {}

      if rel[1] == 'unicode-to-text':
        self.unicode_to(rel[0], 'text', rel[2], meta)
      elif rel[1] == 'unicode-to-math':
        self.unicode_to(rel[0], 'math', rel[2], meta)
      elif rel[1] == 'unicode-to-tex':
        self.unicode_to(rel[0], 'text', rel[2], meta)
        self.unicode_to(rel[0], 'math', rel[2], meta)
      elif rel[1] == 'unicode-is-text':
        self.unicode_to(rel[0], 'text', rel[2], meta)
        self.tex_to(rel[2], rel[0])
      elif rel[1] == 'unicode-is-math':
        self.unicode_to(rel[0], 'math', rel[2], meta)
        self.tex_to(rel[2], rel[0])
      elif rel[1] == 'tex-to-unicode':
        self.tex_to(rel[0], rel[2])
      else:
        raise ValueError(rel[1])

    self.db.execute('CREATE TABLE tuples AS SELECT DISTINCT * FROM build')
    self.db.commit()

  def tex_to(self, latex, ucode):
    if type(latex) != list: latex = [ latex ]
    for tex in latex:
      self.db.execute('INSERT INTO build (latex, relation, unicode, isspace) VALUES (?, ?, ?, 0)', [tex, 'tex-to-unicode', ucode])

  def unicode_to(self, ucodes, mode, latex, meta):
    if meta.get('space'):
      isspace = 1
    else:
      isspace = 0
    if type(ucodes) != list: ucodes = [ ucodes ]
    for ucode in ucodes:
      self.db.execute('INSERT INTO build (unicode, relation, latex, isspace, package) VALUES (?, ?, ?, ?, ?)', [ucode, f'unicode-to-{mode}', latex, isspace, meta.get('package')])

#convert = Tuples()
convert = Legacy()
convert.save()
