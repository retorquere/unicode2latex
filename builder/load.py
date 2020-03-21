import json
import re
import sys, os
import collections
from builder.json import ConfigJSONEncoder, TableJSONEncoder

class load:
  def __init__(self, db, configfile, tables):
    self.db = db
    self.tables = tables

    with open(configfile) as f:
      config = [(cfg if len(cfg) == 4 else (cfg + [{}])) for cfg in json.load(f)]
    for _from, _relation, _to, _meta in config:
      self.add(_from, _relation, _to, _meta)
    db.commit()
    self.verify()
    self.compact(configfile)
    db.commit()
    self.make_tables()

  def add(self, _from, _relation, _to, _meta):
    if type(_from) == list:
      return [self.add(f, _relation, _to, _meta) for f in _from]
    if type(_to) == list:
      return [self.add(_from, _relation, t, _meta) for t in _to]

    for k, v in list(_meta.items()):
      if v is None or v == False:
        del _meta[k]

      elif k in ['textpackages', 'mathpackages']:
        if type(v) == str:
          _meta[k] = sorted([ p for p in re.split(r'[ ,]+', v) if p != '' ])
        else:
          _meta[k] = sorted(v)
      elif k in ['space', 'combiningdiacritic']:
        assert _meta[k]
      else:
        raise ValueError(f'Unexpected metadata: {k}')

    if _relation == 'unicode-to-text' or _relation == 'unicode-to-math':
      if _to.endswith('{}'): _to = _to[:-2]
      self.db.execute('INSERT INTO ucode2tex (ucode, tex, mode, metadata) VALUES (?, ?, ?, ?)', [_from, _to, _relation[-4:], json.dumps(_meta, sort_keys=True) ])

    elif _relation == 'tex-to-unicode':
      if _from.endswith('{}'): _from = _from[:-2]
      self.db.execute('INSERT INTO tex2ucode (tex, ucode, metadata) VALUES (?, ?, ?)', [_from, _to, json.dumps(_meta, sort_keys=True) ])
      pass

    elif _relation == 'unicode-is-tex':
      self.add(_from, 'unicode-to-text', _to, _meta)
      self.add(_from, 'unicode-to-math', _to, _meta)
      self.add(_to, 'tex-to-unicode', _from, _meta)

    elif _relation == 'unicode-is-text':
      self.add(_from, 'unicode-to-text', _to, _meta)
      self.add(_to, 'tex-to-unicode', _from, _meta)

    elif _relation == 'unicode-is-math':
      self.add(_from, 'unicode-to-math', _to, _meta)
      self.add(_to, 'tex-to-unicode', _from, _meta)

    elif _relation == 'unicode-to-tex':
      self.add(_from, 'unicode-to-text', _to, _meta)
      self.add(_from, 'unicode-to-math', _to, _meta)

    else:
      raise ValueError(_relation)

  def verify(self):
    missing = False
    for (tex,) in self.db.execute('SELECT DISTINCT ucode2tex.tex FROM ucode2tex LEFT JOIN tex2ucode on ucode2tex.tex = tex2ucode.tex WHERE tex2ucode.tex IS NULL'):
      if '\\' in tex or '{' in tex or '}' in tex or '^' in tex or '_' in tex:
        missing = True
        print(f'Missing tex2ucode mapping for {json.dumps(tex)}')
    if missing: sys.exit(1)

  def row(self, row, metadata):
    if len(metadata) > 0: row.append(metadata)
    return tuple(row)

  def compact(self, filename):
    compacted = []

    # unicode-is-tex
    sql = '''
      SELECT tex2ucode.ucode, tex2ucode.tex, tex2ucode.rowid, text.rowid, math.rowid, math.metadata
      FROM tex2ucode
      JOIN ucode2tex text ON text.mode = 'text' AND text.ucode = tex2ucode.ucode AND text.tex = tex2ucode.tex AND tex2ucode.metadata = text.metadata
      JOIN ucode2tex math ON math.mode = 'math' AND math.ucode = tex2ucode.ucode AND math.tex = tex2ucode.tex AND tex2ucode.metadata = math.metadata
    '''
    for ucode, tex, t2u, u2text, u2math, metadata in self.db.execute(sql):
      self.db.execute('UPDATE tex2ucode SET exported = ? WHERE rowid = ?', ('unicode-is-tex', t2u))
      self.db.execute('UPDATE ucode2tex SET exported = ? WHERE rowid IN (?, ?)', ('unicode-is-tex', u2text, u2math))

      compacted.append(self.row([ ucode, ucode, 'unicode-is-tex', tex ], json.loads(metadata)))

    # unicode-is-text/math
    sql = f'''
      SELECT ucode2tex.rowid, tex2ucode.rowid, ucode2tex.ucode, ucode2tex.tex, ucode2tex.mode, ucode2tex.metadata
      FROM ucode2tex
      JOIN tex2ucode ON ucode2tex.ucode = tex2ucode.ucode AND ucode2tex.tex = tex2ucode.tex AND ucode2tex.metadata = tex2ucode.metadata
      WHERE ucode2tex.exported IS NULL AND tex2ucode.exported IS NULL
    '''
    for u2t, t2u, ucode, tex, mode, metadata in self.db.execute(sql):
      mode = f'unicode-is-{mode}'
      self.db.execute('UPDATE tex2ucode SET exported = ? WHERE rowid = ?', (mode, t2u))
      self.db.execute('UPDATE ucode2tex SET exported = ? WHERE rowid = ?', (mode, u2t))

      compacted.append(self.row([ ucode, ucode, mode, tex ], json.loads(metadata)))

    # unicode-to-tex
    sql = '''
      SELECT text.ucode, text.tex, text.rowid, math.rowid, text.metadata
      FROM ucode2tex text
      JOIN ucode2tex math ON math.mode = 'math' AND text.ucode = math.ucode AND text.tex = math.tex AND text.metadata = math.metadata
      WHERE text.mode = 'text' AND text.exported IS NULL AND math.exported IS NULL
    '''
    for ucode, tex, u2text, u2math, metadata in self.db.execute(sql):
      self.db.execute('UPDATE ucode2tex SET exported = ? WHERE rowid IN (?, ?)', ('unicode-to-tex', u2text, u2math))
      compacted.append(self.row([ ucode, ucode, 'unicode-to-tex', tex ], json.loads(metadata)))

    # unicode-to-text/math
    sql = f'''
      SELECT GROUP_CONCAT(rowid, CAST(x'09' AS TEXT)), GROUP_CONCAT(ucode, CAST(x'09' AS TEXT)), mode, tex, metadata
      FROM ucode2tex
      WHERE exported IS NULL
      GROUP BY tex, mode, metadata
    '''
    for rowid, ucode, mode, tex, metadata in self.db.execute(sql):
      rowid = rowid.split('\t')
      if '\t' in ucode: ucode = sorted(ucode.split('\t'))
      mode = f'unicode-to-{mode}'

      self.db.execute(f"UPDATE ucode2tex SET exported = '{mode}' WHERE rowid IN ({', '.join(rowid)})")

      compacted.append(self.row([ min(ucode), ucode, mode, tex ], json.loads(metadata)))

    # tex-to-unicode
    sql = f'''
      SELECT GROUP_CONCAT(rowid, CAST(x'09' AS TEXT)), GROUP_CONCAT(tex, CAST(x'09' AS TEXT)), ucode, metadata
      FROM tex2ucode
      WHERE exported IS NULL
      GROUP BY ucode, metadata
    '''
    for rowid, tex, ucode, metadata in self.db.execute(sql):
      rowid = rowid.split('\t')
      if '\t' in tex: tex = sorted(tex.split('\t'))

      self.db.execute(f"UPDATE tex2ucode SET exported = 'tex-to-unicode' WHERE rowid IN ({', '.join(rowid)})")

      compacted.append(self.row([ ucode, tex, 'tex-to-unicode', ucode ], json.loads(metadata)))

    missing = [ ('tex2ucode', tex) for (tex,) in self.db.execute('SELECT tex FROM tex2ucode WHERE exported IS NULL') ]
    missing += [ ('ucode2tex', tex) for (tex,) in self.db.execute('SELECT DISTINCT tex FROM ucode2tex WHERE exported IS NULL') ]
    if len(missing) > 0:
      print(missing)
      sys.exit(1)

    # sort on ucode ASC, relation DESC
    def minor(row):
      return row[2]
    def major(row):
      if row[2].startswith('unicode-'):
        if type(row[1]) == list: return min(row[0])
        return row[1]
      elif row[2] == 'tex-to-unicode':
        return row[3]
      raise ValueError(str(row))
    compacted = sorted(compacted, key=minor, reverse=True)
    compacted = sorted(compacted, key=major)
    compacted = [tuple(c[1:]) for c in compacted]

    with open(filename, 'w') as f:
      print(json.dumps(compacted, ensure_ascii=True, cls=ConfigJSONEncoder), file=f)

  def make_tables(self):
    with open(os.path.join(self.tables, 'latex.json'), 'w') as f:
      table = {}
      for tex, ucode, metadata in self.db.execute('SELECT tex, ucode, metadata from tex2ucode ORDER BY ucode'):
        metadata = json.loads(metadata)
        if metadata.get('combiningdiacritic', False):
          table[tex] = { 'combiningdiacritic': ucode }
        else:
          table[tex] = ucode
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    table = {}
    for ucode, mode, tex, metadata in self.db.execute('SELECT ucode, mode, tex, metadata FROM ucode2tex ORDER BY ucode'):
      if re.match(r'.*\\[0-1a-zA-Z]+$', tex): tex += '{}'
      table[ucode] = table.get(ucode, {})
      table[ucode][mode] = tex

      for k, v in json.loads(metadata).items():
        if k in ['textpackages', 'mathpackages']:
          assert type(v) == list, metadata
          table[ucode][k] = sorted(set(table[ucode].get(k, []) + v))
        elif k in ['space', 'combiningdiacritic']:
          assert v and (not k in table[ucode] or table[ucode])
          table[ucode][k] = v

    with open(os.path.join(self.tables, 'ascii.json'), 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)
    for ucode in list(table.keys()):
      if ucode not in '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF<>\\#$%&^_{}~':
        del table[ucode]
    with open(os.path.join(self.tables, 'unicode.json'), 'w') as f:
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

