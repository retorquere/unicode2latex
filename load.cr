#!/usr/bin/env crystal

require "csv"
require "json"

#def hex(n : Int32) : String
#  "\\u#{n.to_s(16).rjust(4, "0")}"
#end
def ascii(s : String) : String
  return s
  #s.gsub(/[^ -~\r\n]/){|c| c.dump_unquoted}
end

def permutations(s : String) : Array(String)
  return s.chars.permutations.map{|p| p.join("")}
end

class TeXChar
  property math = ""
  property text = ""
  property alt = [] of String
  property stopgap = false
  property commandspacer = false

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

  def reset
    @math = ""
    @text = ""
    @alt = [] of String
    @stopgap = false
  end

  def to_json(json : JSON::Builder)
    json.object {
      json.field "text", @text if @text != ""
      json.field "math", @math if @math != ""
      json.field "commandspacer", @commandspacer if @commandspacer
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

class Mapping
  property unicode : String
  property conversion : String
  property tex : String
  property mode : String = ""
  property package : String = ""

  property stopgap : Bool = false
  property combining : Bool = false
  property space : Bool = false

  def initialize(stanza : Array(String))
    @unicode = stanza.shift()
    @conversion = {"<" => "t2u", ">" => "u2t", "=" => "="}[stanza.shift()]
    @tex = stanza.shift()

    while flag = stanza.shift?
      case flag
        when "math", "text"
          @mode = flag
          @package = ""
        when /^(math|text)[.]([-a-z]+)$/i
          @mode = $1
          @package = $2
        when "stopgap"
          @stopgap = true
        when "combining"
          @combining = true
        when "space"
          @space = true
        else
          raise flag
      end
    end

    @unicode = @unicode.unicode_normalize(:nfd) if @combining

    raise "sus conversion" if @stopgap && @conversion == '='
  end

  def u2t?
    return @conversion.match(/^(=|u2t)$/)
  end
  def t2u?
    return @conversion.match(/^(=|t2u)$/)
  end
  def modes
    return @mode == "" ? [ "math", "text" ] : [ @mode ]
  end
end

TeXMap = CSV.parse(File.read("config.ssv"), separator=' ', quote_char='@')
  .select{|row| row.join("") != "" && !row[0].match(/^(\/\/|##)/)}
  .map{|row| Mapping.new(row)}

class Combining
  @regex : String

  def initialize
    @commands = Set(String).new
    @tolatex = {} of String => NamedTuple(mode: String, command: String)
    @tounicode = {} of String => String

    single = ""
    multi = [] of String

    # the sort will handle text after math so that text gets precedence
    TeXMap.sort{|a, b| a.mode <=> b.mode}.select{|c| c.combining}.each do |c|
      raise "update tx" if c.unicode.size > 2
      
      if c.unicode.size == 1
        single += c.unicode
      else
        multi << "(#{permutations(c.unicode).join("|")})"
      end

      @commands << $1 if c.tex.match(/^\\([a-z]+)$/)

      if (c.tex[0] == '\\')
        cmd = c.tex[1..].sub("{}", "")
        @tounicode[cmd] = c.unicode
        @tolatex[c.unicode] = { mode: c.mode, command: cmd }
      end
    end

    multi << "[#{single}]" if single.size > 0
    @regex = multi.join("|")
  end
  
  def save(filename : String)
    File.open(filename, "w") do |f|
      f.puts ascii({ commands: @commands.to_a.sort, tolatex: @tolatex, tounicode: @tounicode, regex: @regex }.to_json)
    end
  end
end

Combining.new.save("tables/combining.json")

class U2T
  def initialize(mode : String)
    @package = Hash(String, Hash(String, TeXChar)).new do |hash, key|
      hash[key] = Hash(String, TeXChar).new do |inner_hash, inner_key|
        inner_hash[inner_key] = TeXChar.new
      end
    end
    minimal = /^[\x{00A0}\x{180E}\x{2000}-\x{200B}\x{202F}\x{205F}\x{3000}\x{FEFF}#<>\\#$%&^_{}~\]]$/

    # https://github.com/retorquere/zotero-better-bibtex/issues/1189
    # Needed so that composite characters are counted as single characters
    # for in-text citation generation. This messes with the {} cleanup
    # so the resulting TeX will be more verbose; doing this only for
    # bibtex because biblatex doesn't appear to need it.
   
    # Only testing ascii.text because that's the only place (so far)
    # that these have turned up.
    # https://github.com/retorquere/zotero-better-bibtex/issues/1538
    # Further workarounds because bibtex inserts an NBSP for \o{}x in author names, which is insane, but that's bibtex for ya
    # ??
    # if re.match(r'^[a-zA-Z]$', marker):
    # diacritic_re.append(re.escape(marker) + r'[^a-zA-Z]')
    # diacritic_re.append(re.escape(marker) + r'$')

    TeXMap.select{|c| c.u2t?}.each do |c|
      next if mode == "minimal" && c.unicode !~ minimal
      raise c.tex if mode == "minimal" && c.package != ""

      m = @package[c.package][c.unicode]
      # currently have a stopgap, but we have a good replacement
      if m.stopgap && !c.stopgap && c.package == ""
        puts "replacing stopgap #{m.text}/#{m.math}"
        m.reset
      end
      c.modes.each do |cmode|
        next if !m.empty? && c.stopgap # already have better good option

        m[cmode] = c.tex
        m.stopgap = c.stopgap

        if cmode === "text"
          commandspacer = c.tex.matches?(/\\[0-1a-z]+$/i) && !c.combining
          case mode
            when "bibtex"
              if commandspacer # See #1538.
                m.text = "{#{m.text}}"
              elsif m.text =~ /^\\[`'^~"=.][A-Za-z]$/ || m.text =~ /^\\[\^]\\[ij]$/ || m.text =~ /^\\[kr]\{[a-zA-Z]?\}$/
                m.text = "{#{m.text}}"
              elsif m.text =~ /^\\(L|O|AE|AA|DH|DJ|OE|SS|TH|NG)\{\}$/i
                m.text = "{\\#{$1}}"
              elsif m.text =~ /^\\([a-z])\{([a-z0-9])\}$/i
                m.text = "{\\#{$1} #{$2}}"
              else
                m.commandspacer = commandspacer
              end
            when "biblatex", "minimal"
              m.commandspacer = commandspacer
          end
        end

        if c.package == "" && mode =~ /^bib(la)?tex$/
          m.alt = TeXMap.select{|alt| alt.u2t? && alt.unicode == c.unicode && alt.package != ""}.map{|alt| alt.package}.uniq.sort
        end
      end
    end
  end

  def save(filename : String)
    File.open(filename, "w") do |f|
      f.puts ascii({ base: @package[""], package: @package.reject{|k, v| k == ""} }.to_json)
    end
  end
end

U2T.new("biblatex").save("tables/biblatex.json")
U2T.new("bibtex").save("tables/bibtex.json")
U2T.new("minimal").save("tables/minimal.json")

class T2U
  def initialize
    @mapping = {} of String => String
    TeXMap.select{|c| c.t2u?}.each do |c|
      @mapping[c.tex] = c.unicode
    end
    @mapping = @mapping.to_a.sort_by{|k| k.first}.to_h
  end

  def save(filename : String)
    File.open(filename, "w") do |f|
      f.puts ascii(@mapping.to_json)
    end
  end
end
T2U.new.save("tables/latex2unicode.json")
