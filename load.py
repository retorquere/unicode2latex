#!/usr/bin/env python3

import sqlite3
import os, sys
from builder.load import load
from builder.json import TableJSONEncoder, ConfigJSONEncoder

if len(sys.argv) == 1:
  dbname = ':memory:'
elif len(sys.argv) == 2 and sys.argv[1].endswith('.sqlite'):
  dbname = sys.argv[1]
else:
  print('Unexpected command line:', sys.argv)
  sys.exit(1)

if dbname[0] != ':' and os.path.exists(dbname): os.remove(dbname)
db = sqlite3.connect(dbname)
db.execute("""
  CREATE TABLE ucode2tex (
    ucode NOT NULL CHECK (ucode <> ''),
    tex NOT NULL CHECK (ucode <> ''),
    mode CHECK (mode in ('math', 'text')),
    metadata json,

    exported CHECK (exported IS NULL or EXPORTED like '%-%'),
    PRIMARY KEY(ucode, mode)
  )
""")
db.execute("""
  CREATE TABLE tex2ucode (
    tex NOT NULL CHECK (ucode <> ''),
    ucode NOT NULL CHECK (ucode <> ''),
    metadata json,

    exported CHECK (exported IS NULL or EXPORTED like '%-%'),
    PRIMARY KEY(tex)
  )
""")

db.execute('''
  CREATE VIEW mapping AS 
    SELECT ucode, 'unicode-to-' || mode as rel, tex, metadata FROM ucode2tex

    UNION

    SELECT ucode, 'tex-to-unicode', tex, metadata FROM tex2ucode
''')

if not os.path.exists('tables'): os.mkdir('tables')
load(db, 'config.json', 'tables')

#for row in db.execute("select json_extract(metadata, '$.space') from u2l"):
#  print(row)
