import json
import re
import sys, os
import collections
from builder.json import ConfigJSONEncoder, TableJSONEncoder
from itertools import permutations
from copy import deepcopy

class load:
  def __init__(self, db, configfile, tables):
    self.db = db
    self.tables = tables

    with open(configfile) as f:
      # load mappings and add empty meta dict if missing
      config = [(cfg if len(cfg) == 4 else (cfg + [{}])) for cfg in json.load(f)]
    for _from, _relation, _to, _meta in config:
      self.add(_from, _relation, _to, _meta)
    db.commit()
    self.verify()
    self.compact(configfile)
    db.commit()
    self.make_tables()

  def execute(self, query, values):
    try:
      self.db.execute(query, values)
    except Exception as ex:
      print(query, json.dumps(values, ensure_ascii=True))
      raise ex

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
      # commented out because we need the ending {} for things like \k{}
      # if _to.endswith('{}'): _to = _to[:-2]
      self.execute('INSERT INTO ucode2tex (ucode, tex, mode, metadata) VALUES (?, ?, ?, ?)', [_from, _to, _relation[-4:], json.dumps(_meta, sort_keys=True) ])

    elif _relation == 'tex-to-unicode':
      # commented out because we need the ending {} for things like \k{}
      # if _from.endswith('{}'): _from = _from[:-2]
      self.execute('INSERT INTO tex2ucode (tex, ucode, metadata) VALUES (?, ?, ?)', [_from, _to, json.dumps(_meta, sort_keys=True) ])
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
    sql = '''
      SELECT DISTINCT ucode2tex.tex
      FROM ucode2tex
      LEFT JOIN tex2ucode on ucode2tex.tex = tex2ucode.tex OR ucode2tex.tex = tex2ucode.tex || '{}'
      WHERE tex2ucode.tex IS NULL AND (
        ucode2tex.tex LIKE '%\\%' OR
        ucode2tex.tex LIKE '%{%' OR
        ucode2tex.tex LIKE '%}%' OR
        ucode2tex.tex LIKE '%^%' OR
        ucode2tex.tex LIKE '%=_%' ESCAPE '='
      )
    '''
    # print((' '.join(sql.replace('\n', ' ').split())).strip())
    for (tex,) in self.db.execute(sql):
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

    combining_diacritic = []
    other = []
    for mapping in compacted:
      # compacted = sortcode, from, relation, to, metadata(optional)
      if len(mapping) == 5 and 'combiningdiacritic' in mapping[4]:
        combining_diacritic.append(tuple(mapping[1:]))
      else:
        other.append(mapping)

    # sort non-CD on ucode ASC, relation DESC
    def minor(row):
      return row[2]
    def major(row):
      if row[2].startswith('unicode-'):
        if type(row[1]) == list: return min(row[0])
        return row[1]
      elif row[2] == 'tex-to-unicode':
        return row[3]
      raise ValueError(str(row))
    other = sorted(other, key=minor, reverse=True)
    other = sorted(other, key=major)
    other = [tuple(c[1:]) for c in other]

    combining_diacritic = sorted(combining_diacritic, key=lambda x: x[2])
    combining_diacritic = sorted(combining_diacritic, key=lambda x: x[1], reverse=True)
    combining_diacritic = sorted(combining_diacritic, key=lambda x: x[0])

    compacted = other + combining_diacritic

    with open(filename, 'w') as f:
      print(json.dumps(compacted, ensure_ascii=True, cls=ConfigJSONEncoder), file=f)

  def make_tables(self):
    combining_diacritic = { 'tolatex': {}, 'tounicode': {}, 'commands': [] }

    diacritic_markers = set()
    with open(os.path.join(self.tables, 'latex.json'), 'w') as f:
      table = {}
      for tex, ucode, metadata in self.db.execute('SELECT tex, ucode, metadata from tex2ucode ORDER BY ucode'):
        table[tex] = ucode

        if 'combiningdiacritic' in json.loads(metadata):
          if re.match(r'^\\.$', tex): diacritic_markers.add(tex[1])
          if re.match(r'\\[a-z]+$', tex): combining_diacritic['commands'].append(tex[1:])
          # strip ending {} because we want the command name only
          if tex[0] == '\\': combining_diacritic['tounicode'][tex[1:].replace('{}', '')] = ucode
      print(json.dumps(table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    ascii_table = {}
    # sort by mode so text overwrites math for combining_diacritic['tounicode']
    for ucode, mode, tex, metadata in self.db.execute('SELECT ucode, mode, tex, metadata FROM ucode2tex ORDER BY ucode, mode'):
      # commented out addition of ending {} -- I need to be able to distinguish between \k{} (command with empty arg) and \slash{} (command with separator)

      ucodes = [ ucode ]
      metadata = json.loads(metadata)

      commandspacer = mode == 'text' and re.match(r'.*\\[0-1a-zA-Z]+$', tex)

      if metadata.get('combiningdiacritic'):
        ucodes = [''.join(cp) for cp in permutations(list(ucode))]

      for ucode in ucodes:
        ascii_table[ucode] = ascii_table.get(ucode, {})
        ascii_table[ucode][mode] = tex

        if commandspacer: ascii_table[ucode]['commandspacer'] = True

        for k, v in metadata.items():
          if k in ['textpackages', 'mathpackages']:
            assert type(v) == list, metadata
            ascii_table[ucode][k] = sorted(set(ascii_table[ucode].get(k, []) + v))

          elif k in ['space', 'combiningdiacritic']:
            assert v and (not k in ascii_table[ucode] or ascii_table[ucode])
            ascii_table[ucode][k] = v

            if k == 'combiningdiacritic' and tex[0] == '\\':
              # string ending {} because we want the command name only
              combining_diacritic['tolatex'][ucode] = { 'mode': mode, 'command': tex[1:].replace('{}', '') }
              if re.match(r'\\[a-z]+$', tex): combining_diacritic['commands'].append(tex[1:])
              # string ending {} because we want the command name only
              if tex[0] == '\\': combining_diacritic['tounicode'][tex[1:].replace('{}', '')] = ucode

    # ascii
    with open(os.path.join(self.tables, 'ascii.json'), 'w') as f:
      print(json.dumps(ascii_table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    # https://github.com/retorquere/zotero-better-bibtex/issues/1189
    # Needed so that composite characters are counted as single characters
    # for in-text citation generation. This messes with the {} cleanup
    # so the resulting TeX will be more verbose; doing this only for
    # bibtex because biblatex doesn't appear to need it.
    #
    # Only testing ascii.text because that's the only place (so far)
    # that these have turned up.
    creator_name_table = deepcopy(ascii_table)
    diacritic_re = []
    for marker in diacritic_markers:
      if re.match(r'^[a-zA-Z]$', marker):
        diacritic_re.append(re.escape(marker) + r'[^a-zA-Z]')
        diacritic_re.append(re.escape(marker) + r'$')
      else:
        diacritic_re.append(re.escape(marker))
    diacritic_re = re.escape('\\') + '(' + '|'.join(diacritic_re) + ')'
    for ucode, mapping in list(creator_name_table.items()):
      if not 'text' in mapping: continue

      text = mapping['text']
      mapping.pop('commandspacer', None)

      if re.match(r'^\\[`\'^~"=.][A-Za-z]$', text) or re.match(r'^\\[\^]\\[ij]$', text) or re.match(r'^\\[kr]\{[a-zA-Z]\}$', text):
        text = f'{{{text}}}'
      elif (m := re.match(r'^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$', text, re.IGNORECASE)) is not None:
        text = f'{{\\{m.group(1)}}}'
      elif (m := re.match(r'^\\([a-zA-Z])\{([a-zA-Z0-9])\}$', text)) is not None:
        text = f'{{\\{m.group(1)} {m.group(2)}}}'
      elif not 'combiningdiacritic' in mapping and text[0] != '{' and text[-1] != '}' and re.search(diacritic_re, text):
        text = f'{{{text}}}'
      else:
        if re.match(r'.*\\[0-1a-zA-Z]+$', text) and not mapping.get('combiningdiacritic'):
          mapping['commandspacer'] = True

      mapping['text'] = text
    with open(os.path.join(self.tables, 'ascii-bibtex-creator.json'), 'w') as f:
      print(json.dumps(creator_name_table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    # unicode
    unicode_table = deepcopy(ascii_table)
    for ucode in list(unicode_table.keys()):
      if ucode not in '\u00A0\u180E\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u200B\u202F\u205F\u3000\uFEFF<>\\#$%&^_{}~' and ucode != "/\u200b":
        del unicode_table[ucode]
    with open(os.path.join(self.tables, 'unicode.json'), 'w') as f:
      print(json.dumps(unicode_table, ensure_ascii=True, cls=TableJSONEncoder), file=f)

    # diacritics
    with open(os.path.join(self.tables, 'diacritics.json'), 'w') as f:
      combining_diacritic['commands'] = sorted(list(set(combining_diacritic['commands'])))
      print(json.dumps(combining_diacritic, sort_keys=True, ensure_ascii=True, indent='  '), file=f)

