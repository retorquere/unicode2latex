#!/usr/bin/env crystal

require "csv"
require "json"
require "sqlite3"
require "benchmark"

puts "building tables"

def section(s : String)
  return "  #{s.ljust(20, ' ')} "
end

class Row < Hash(String, String)
  macro method_missing(call)
    {% if call.args.size == 0 %}
      self[{{call.name.stringify}}]
    {% else %}
      super
    {% end %}
  end
end

class DB::Database
  def q(query : String) : Array(Row)
    results = [] of Row
    self.query(query) do |rs|
      rs.each do
        results << Row.new
        rs.column_names.each do |col|
          results[-1][col] = rs.read.to_s
        end
      end
    end
    results
  end
end

#TeXMap = DB.open "sqlite3://"
TeXMap = DB.open "sqlite3://./unicode.sqlite"
TeXMap.exec "DROP TABLE IF EXISTS texmap"
TeXMap.exec "CREATE TABLE texmap (
  line INT NOT NULL,
  unicode TEXT NOT NULL,
  conversion CHECK(conversion IN ('=', 't2u', 'u2t')),
  tex TEXT NOT NULL,
  mode CHECK(mode IN ('', 'math', 'text')),
  package TEXT,
  combining NOT NULL CHECK(combining IN (0, 1)),
  stopgap NOT NULL CHECK(combining IN (0, 1))
)"

errors = false

puts section("loading config") + Benchmark.measure {
  CSV.parse(File.read("config.ssv"), separator=' ', quote_char='@')
    .each_with_index.map { |item, index| {index + 1, item} }
    .select{|index, row| row.join("") != "" && !row[0].match(/^(\/\/|##)/)}
    .each do |line, stanza|
      unicode = String.from_json("\"" + stanza.shift() + "\"").unicode_normalize(:nfd)
      conversion = {"<" => "t2u", ">" => "u2t", "=" => "="}[stanza.shift()]
      tex = stanza.shift()
  
      mode : String = ""
      package : String = ""
      combining = 0
      stopgap = 0
  
      while flag = stanza.shift?
        case flag
          when "math", "text"
            mode = flag
          when /^(math|text)[.]([-a-z]+)$/i
            mode = $1
            package = $2
          when /^[.]([-a-z]+)$/i
            package = $1
          when "stopgap"
            stopgap = 1
          when "combining"
            combining = 1
          when "space"
            #@space = true
          else
            raise flag
            puts "Unexpected flag #{flag}"
            errors = true
        end
      end
  
      if stopgap == 1 && conversion == "="
        puts "suspect stopgap conversion for #{unicode} = #{tex}"
        errors = true
      end
  
      TeXMap.exec "INSERT INTO texmap (line, unicode, conversion, tex, mode, package, combining, stopgap) values (?, ?, ?, ?, ?, ?, ?, ?)", line, unicode, conversion, tex, mode, package, combining, stopgap
    end
}.to_s

# ---- sanity checks ---- #

puts section("sanity checks") + Benchmark.measure {
  TeXMap.q("SELECT * FROM texmap WHERE mode = 'text' ORDER BY line").each do |c|
    if c.unicode.match(/^[A-Za-z0-9]$/)
      puts "null mapping for #{c.unicode}"
      errors = true
    end
  end

  TeXMap.q("SELECT * FROM texmap WHERE conversion in ('=', 'u2t') AND stopgap <> 0 AND tex like '%\\\\%' ORDER BY line").each do |c|
    puts "faulty stopgap #{c.tex}"
    errors = true
  end

  TeXMap.q("
    SELECT simple.*, multi.tex as multi
    FROM texmap simple
    JOIN texmap multi ON
      CASE multi.mode WHEN '' THEN simple.mode ELSE multi.mode END = simple.mode
      AND multi.conversion IN ('=', 't2u')
      AND multi.tex LIKE '%\\\\_%\\\\' AND
      multi.package = ''
    WHERE
      simple.conversion IN ('=', 't2u')
      AND simple.tex NOT LIKE '%\\\\_%\\\\'
      AND simple.package = ''
  ").each do |c|
    puts "swap #{c.tex} (#{c.mode}) with #{c.multi}"
    errors = true
  end

  TeXMap.q("
    SELECT notcombining.*
    FROM texmap notcombining
    WHERE
      notcombining.combining = 0
      AND (notcombining.tex LIKE '\\\\[^a-zA-Z][a-zA-Z]' OR notcombining.tex LIKE '\\\\_{[a-zA-Z]}')
      AND EXISTS (
        SELECT 1
        FROM texmap combining
        WHERE combining.combining = 1 AND combining.package = '' AND notcombining.unicode LIKE '%' || combining.unicode
      )
  ").each do |c|
    puts "remove #{c.tex} on line #{c.line}"
    errors = true
  end

  TeXMap.q("
    SELECT me.*, other.line as conflict, CASE WHEN other.unicode = me.unicode THEN 'unicode' ELSE 'tex' END AS kind
    FROM texmap me
    JOIN texmap other ON
      other.line <> me.line
      AND other.conversion = '='
      AND (other.unicode = me.unicode OR other.tex = me.tex)
      AND me.mode = other.mode
      AND me.package = other.package
    WHERE me.conversion = '=' AND me.package <> ''
  ").each do |c|
    puts "#{c.kind} conflict between lines #{c.line} and #{c.conflict}"
    errors = true
  end
}.to_s

exit(1) if errors

# ---- conversion ---- #

def permutations(s : String) : Array(String)
  return s.chars.permutations.map{|p| p.join("")}
end

def ascii(s : String) : String
  return s
  s.gsub(/[^ -~\r\n]/){|c| "\\u%04X" % c[0].ord }
end

#puts TeXMap.scalar "select count(*), max(line) from texmap"

class Combining
  @regex : String

  def initialize
    @macros = Set(String).new
    @tolatex = {} of String => NamedTuple(mode: String, macro: String)
    @tounicode = {} of String => String

    single = ""
    multi = [] of String

    # the sort will handle text after math so that text gets precedence
    TeXMap.q("SELECT * FROM texmap WHERE combining = 1 ORDER BY mode, line").each do |c|
      raise "update tx" if c.unicode.size > 2

      if c.unicode.size == 1
        single += c.unicode
      else
        multi << "(#{permutations(c.unicode).join("|")})"
      end

      @macros << $1 if c.tex.match(/^\\([a-z]+)$/)

      if (c.tex[0] == '\\')
        m = c.tex[1..].sub("{}", "")
        @tounicode[m] = c.unicode if c.conversion =~ /t2u|=/
        @tolatex[c.unicode] = { mode: c.mode, macro: m } if c.conversion =~ /u2t|=/
      end
    end

    multi << "[#{single}]" if single.size > 0
    @regex = multi.join("|")
  end

  def save(filename : String)
    File.open(filename, "w") do |f|
      f.puts ascii({ macros: @macros.to_a.sort, tolatex: @tolatex, tounicode: @tounicode, regex: @regex }.to_json)
    end
  end
end

Combining.new.save("tables/combining.json")

class TeXChar
  property math = ""
  property text = ""
  property alt = [] of String
  property macrospacer = false
  property stopgap = false

  def [](key : String)
    case key
      when "math"
        @math
      when "text"
        @text
      else
        raise key
    end
  end
  def []=(key : String, value : String)
    case key
      when "math"
        @math = value
      when "text"
        @text = value
      else
        raise key
    end
  end

  def empty?
    return @math + @text == ""
  end

  def to_json(json : JSON::Builder)
    json.object {
      json.field "text", @text if @text != ""
      json.field "math", @math if @math != ""
      json.field "macrospacer", @macrospacer if @macrospacer
      unless @alt.empty?
        json.field "alt" {
          json.array {
            @alt.each {|alt|
              json.string alt
            }
          }
        }
      end
    }
  end
end

class U2T
  def initialize(@map : String)
    @package = Hash(String, Hash(String, TeXChar)).new do |packages, package|
      packages[package] = Hash(String, TeXChar).new do |texchars, unicode|
        texchars[unicode] = TeXChar.new
      end
    end

    minimal = /^[\x{00A0}\x{180E}\x{2000}-\x{200B}\x{202F}\x{205F}\x{3000}\x{FEFF}#<>\\#$%&^_{}~\]]$/

    # this order means stopgaps will be overwritten if a non-stopgap option exists
    TeXMap.q("
        SELECT tex.*, (
          SELECT GROUP_CONCAT(package)
          FROM texmap alt
          WHERE tex.package = '' AND alt.package <> '' AND tex.unicode = alt.unicode AND alt.conversion IN ('u2t', '=')
        ) AS alt
        FROM texmap tex
        WHERE tex.conversion IN ('u2t', '=')
        ORDER BY tex.stopgap, tex.mode, tex.line
    ").each do |c|
      next if @map == "minimal" && c.unicode !~ minimal
      raise c.tex if @map == "minimal" && c.package != ""

      m = @package[c.package][c.unicode]
      # better alternative available
      if m.stopgap && c.stopgap == "0" && c.package == ""
        puts "  replacing stopgap #{m.text}/#{m.math}"
        m = @package[c.package][c.unicode] = TeXChar.new
      end
      m.stopgap = c.stopgap == "1"

      (c.mode == "" ? [ "text", "math" ] : [ c.mode ]).each do |mode|
        m[mode] = c.tex # TODO: overwrites with single mode ... this does not work for <>

        if mode === "text"
          macrospacer = c.tex.matches?(/\\[0-1a-z]+$/i) || (c.combining == "1")
          case @map
            when "bibtex"
              if macrospacer # See #1538.
                m.text = "{#{m.text}}"
              elsif m.text =~ /^\\[`'^~"=.][A-Za-z]$/ || m.text =~ /^\\[\^]\\[ij]$/ || m.text =~ /^\\[kr]\{[a-zA-Z]?\}$/
                m.text = "{#{m.text}}"
              elsif m.text =~ /^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i
                m.text = "{\\#{$1}}"
              elsif m.text =~ /^\\([a-z])\{([a-z0-9])\}$/i
                m.text = "{\\#{$1} #{$2}}"
              else
                m.macrospacer = macrospacer
              end
            when "biblatex", "minimal"
              m.macrospacer = macrospacer
          end
        end

        m.alt = c.alt.split(',').uniq.sort if c.package == "" && @map =~ /^bib(la)?tex$/ && c.alt.size > 0
      end
    end
  end

  def save()
    File.open("tables/#{@map}.json", "w") do |f|
      f.puts ascii({ base: @package[""], package: @package.reject{|k, v| k == ""} }.to_json)
    end
  end
end

["biblatex", "bibtex", "minimal"].each do |map|
  puts section("#{map} map") + Benchmark.measure {
    U2T.new(map).save()
  }.to_s
end

class T2U
  def save(filename : String)
    mapping = Hash(String, Hash(String, String)).new do |mapping, cmd|
      mapping[cmd] = {} of String => String
    end

    other = { "text" => "math", "math" => "text" }

    TeXMap.q("SELECT * FROM texmap tex WHERE tex.conversion IN ('t2u', '=') ORDER BY line DESC").each do |c|
      if c.mode == ""
        mapping[c.tex] = { "math" => c.unicode, "text" => c.unicode }
      else
        mapping[c.tex][c.mode] = c.unicode unless mapping[c.tex].has_key?(c.mode)
        mapping[c.tex][other[c.mode]] = c.tex unless mapping[c.tex].has_key?(other[c.mode]) || c.tex =~ /^[_^]/ || c.tex.includes?('\\')
      end
    end

    t2u = JSON.build do |json|
      json.object {
        mapping.to_a.sort_by{|k, v| k}.to_h.each do |tex, char|
          if char.has_key?("text") && char.has_key?("math") && char["math"] == char["text"]
            json.field(tex, char["text"])
          elsif char.keys.size == 1
            json.field(tex, char.values.first)
          else
            json.field(tex) {
              json.object {
                json.field("text", char["text"])
                json.field("math", char["math"])
              }
            }
          end
        end
      }
    end

    File.open(filename, "w") do |f|
      f.puts ascii(t2u.to_s)
    end
  end
end
puts section("latex to unicode map") + Benchmark.measure {
  T2U.new.save("tables/latex2unicode.json")
}.to_s
