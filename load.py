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

    dbname = ':memory:'
    dbname = 'tuples.sqlite'

    if dbname[0] != ':' and os.path.exists(dbname): os.remove(dbname)
    self.db = sqlite3.connect(dbname)

    self.db.execute('''
      CREATE TABLE build (
        unicode NOT NULL,
        relation TEXT CHECK (relation IN ('unicode-to-math', 'unicode-to-text', 'tex-to-unicode')),
        latex NOT NULL CHECK (latex <> ''),
        isspace CHECK (isspace in (0, 1)),
        package CHECK ((relation = 'tex-to-unicode' AND package IS NULL) OR relation <> 'tex-to-unicode'),
        iscombiningdiacritic CHECK ((relation = 'unicode-to-text' AND (iscombiningdiacritic IS NULL OR iscombiningdiacritic = 1)) OR (relation <> 'unicode-to-text' AND iscombiningdiacritic IS NULL))
      )
    ''')

    self.db.execute('''
      CREATE TRIGGER consistency BEFORE INSERT ON build
        BEGIN
          SELECT RAISE(ABORT, 'duplicate unicode-to-latex')
          WHERE EXISTS (
            SELECT 1 FROM build WHERE relation in ('unicode-to-math', 'unicode-to-text') AND relation = NEW.relation AND unicode = NEW.unicode
          );

          -- test latex -> unicode
          SELECT RAISE(ABORT, 'duplicate tex-to-unicode')
          WHERE EXISTS (
            SELECT 1 FROM build WHERE relation = 'tex-to-unicode' AND relation = NEW.relation AND latex = NEW.latex
          );
        END
    ''')

  def meta(self, latex):
    assert type(latex) == str
    packages = {'text': [], 'math': []}
    isspace = False
    iscombiningdiacritic = False

    for relation, pkg, sp, icd in self.db.execute('SELECT relation, package, isspace, iscombiningdiacritic FROM tuples WHERE latex = ?', [latex]):
      if not relation.startswith('unicode-to-'): continue
      mode = relation.replace('unicode-to-', '')

      if pkg: packages[mode] += [ p for p in re.split(r'[ ,]', pkg) if p != '' ]
      isspace = isspace or (sp == 1)
      iscombiningdiacritic = iscombiningdiacritic or (icd == 1)

    if len(packages['text']) == 0 and len(packages['math']) == 0 and not isspace: return None

    packages['text'] = sorted(list(set(packages['text'])))
    packages['math'] = sorted(list(set(packages['math'])))

    m = {}

    if packages['text'] == packages['math'] and len(packages['text']) != 0: # strange
      m['packages'] = ' '.join(packages['tex'])
    else:
      if len(packages['text']) > 0: m['textpackages'] = ' '.join(packages['text'])
      if len(packages['math']) > 0: m['mathpackages'] = ' '.join(packages['math'])

    if isspace: m['space'] = True
    if iscombiningdiacritic: m['iscombiningdiacritic'] = True

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
      SELECT tex.unicode, tex.latex, utext.relation, umath.relation
      FROM tuples tex
      LEFT JOIN tuples utext ON utext.unicode = tex.unicode AND utext.latex = tex.latex AND utext.relation = 'unicode-to-text'
      LEFT JOIN tuples umath ON umath.unicode = tex.unicode AND umath.latex = tex.latex AND umath.relation = 'unicode-to-math'
      WHERE tex.relation = 'tex-to-unicode'
    '''
    for ucode, latex, utext, umath in list(self.db.execute(bidi)):
      if utext and umath:
        self.add('unicode-is-tex', ucode, latex)
      elif utext:
        self.add('unicode-is-text', ucode, latex)
      elif umath:
        self.add('unicode-is-math', ucode, latex)
      else:
        continue

      self.db.execute("DELETE FROM tuples WHERE unicode = ? AND relation = 'tex-to-unicode' AND latex = ?", [ucode, latex])
      if utext:
        self.db.execute("DELETE FROM tuples WHERE unicode = ? AND relation = 'unicode-to-text' AND latex = ?", [ucode, latex])
      if umath:
        self.db.execute("DELETE FROM tuples WHERE unicode = ? AND relation = 'unicode-to-math' AND latex = ?", [ucode, latex])

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
    if not os.path.exists('tables'): os.mkdir('tables')

    check = '''
      SELECT DISTINCT u.latex FROM tuples u WHERE u.relation LIKE 'unicode-to-%' AND u.latex LIKE '%\%' AND u.latex NOT IN (SELECT t.latex FROM tuples t WHERE t.relation = 'tex-to-unicode');
    '''
    errors = False
    for (latex,) in self.db.execute(check):
      if ' ' in latex: continue
      print(f'{latex} does not have a tex-to-unicode mapping')
      errors = True
    if errors:
      raise ValueError('please fix')

    table = {}
    for ucode, relation, latex, package, isspace in self.db.execute("SELECT unicode, relation, latex, package, isspace FROM tuples WHERE relation LIKE 'unicode-to-%' ORDER BY unicode ASC, relation DESC"):
      if re.match(r'.*\\[0-1a-zA-Z]+$', latex): latex += '{}'
      table[ucode] = table.get(ucode, {})
      table[ucode][relation.replace('unicode-to-', '')] = latex
    for ucode, relation, latex, package, isspace in self.db.execute("SELECT unicode, relation, latex, package, isspace FROM tuples WHERE relation LIKE 'unicode-to-%' ORDER BY unicode ASC, relation DESC"):
      mode = relation.replace('unicode-to-', '')
      if isspace == 1: table[ucode]['space'] = True
      if package: table[ucode][f'{mode}packages'] = package.split(' ')
    for ucode, config in table.items():
      if 'textpackages' in config and 'mathpackages' in config and config['textpackages'] == config['mathpackages']:
        config['packages'] = config['textpackages']
        del config['textpackages']
        del config['mathpackages']
    with open ('tables/ascii.json', 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)
    for ucode in list(table.keys()):
      if ucode not in '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF<>\\#$%&^_{}~':
        del table[ucode]
    with open ('tables/unicode.json', 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    table = {}
    for latex, relation, ucode in self.db.execute("SELECT latex, relation, unicode FROM tuples WHERE relation = 'tex-to-unicode' ORDER BY unicode, latex"):
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
    with open('config.json', 'w') as f:
      print(json.dumps(tuples, ensure_ascii=True, cls=ConfigJSONEncoder), file=f)

class Tuples(Config):
  def __init__(self):
    super().__init__()

    with open('config.json') as f:
      table = json.load(f)

    for rel in table:
      meta = {}
      if len(rel) == 4: meta = rel[3]

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

      elif rel[1] == 'unicode-is-tex':
        self.unicode_to(rel[0], 'text', rel[2], meta)
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
      if tex.endswith('{}'): tex = tex[:-2]
      self.db.execute('INSERT INTO build (latex, relation, unicode, isspace) VALUES (?, ?, ?, 0)', [tex, 'tex-to-unicode', ucode])

  def unicode_to(self, ucodes, mode, latex, meta):
    if latex.endswith('{}'): latex = latex[:-2]
    if meta.get('space'):
      isspace = 1
    else:
      isspace = 0
    if type(ucodes) != list: ucodes = [ ucodes ]
    for ucode in ucodes:
      self.db.execute('INSERT INTO build (unicode, relation, latex, isspace, package) VALUES (?, ?, ?, ?, ?)', [ucode, f'unicode-to-{mode}', latex, isspace, meta.get(f'{mode}packages', meta.get('packages'))])

convert = Tuples()
#convert = Legacy()
convert.save()
