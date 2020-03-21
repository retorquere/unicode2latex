import json

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
