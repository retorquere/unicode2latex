#!/usr/bin/env crystal

require "csv"
require "json"

InDegree = Hash(String, Int32).new{|h, k| h[k] = 0 }
OutDegree = Hash(String, Int32).new{|h, k| h[k] = 0 }
Eq = Hash(String, String).new
T2U = Hash(String, String).new
StopGap = Set(String).new

class Conv
  property unicode : String
  property dir : String
  property tex : String
  property mode : String
  property stopgap : Bool
  property combining : Bool
  property space : Bool
  property line : Int32

  def initialize(stanza : Array(String), @line : Int32)
    @unicode = String.from_json("\"" + stanza.shift() + "\"")
    raise "#{@line}: [[#{([@unicode] + stanza).join(" ")}]] => [[#{([@unicode.unicode_normalize(:nfd)] + stanza).join(" ")}]][#{@unicode.unicode_normalize(:nfd).unicode_normalize(:nfd)}]" unless @unicode.unicode_normalized?(:nfd)
    @dir = stanza.shift
    @tex = stanza.shift
    @mode = stanza.empty? ? "" : stanza.shift

    @stopgap = false
    @combining = false
    @space = false

    stanza.each do |flag|
      case flag
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

    raise "null mapping for #{@unicode}" if @mode == "text" && @unicode.match(/^[A-Za-z0-9]$/)
    raise "faulty stopgap #{@tex}" if @dir.match(/=>/) && @tex.includes?("\\")
    StopGap.add(@unicode) if @stopgap

    (@mode == "" ? ["math", "text"] : [ @mode ]).each{ |mode|
      T2U["#{@unicode}\t#{mode}"] = @tex if @dir.match(/[=<]/) && !@tex.match(/\\.+\\/) && !mode.match(/[.]/)
    }

    (@mode == "" ? ["math", "text"] : [ @mode.sub(/[.]*/, "") ]).each{ |mode|
      tex_mode = "#{@tex}\t#{mode}"
      ucode_mode = "#{@unicode}\t#{mode}"

      if dir == "="
        case Eq[ucode_mode]?
          when @tex, Nil
            # OK
          else
            puts "conflicting #{tex_mode} <=> #{Eq[ucode_mode]}"
          end
        Eq[ucode_mode] = tex_mode
      end

      (@dir == "=" ? ["<", ">"] : [ @dir ]).each{ |dir|

        if dir == ">"
          InDegree[tex_mode] += 1
          OutDegree[@unicode] += 1
        else
          OutDegree[tex_mode] += 1
          InDegree[@unicode] += 1
        end
      }
    }
  end
end

def load(filename)
  File.open(filename) do |f|
    return CSV.parse(f, separator=' ', quote_char='@')
      .to_a.map_with_index{|stanza, line| { line, stanza } }
      .select{|stanza| stanza[1][0] != "##"}
      .map{|stanza| Conv.new(stanza[1], stanza[0] + 1) }
  end
end
config = load("config.ssv")
puts config.size
config.each do |c|
  next if (c.dir != "=") || (c.mode =~ /[.]/)
  conflict = config.find{|co| co.line != c.line && co.dir == "=" && co.unicode == c.unicode && co.mode == c.mode }
  puts [c, conflict] if conflict
end

cds = config.select{|c| c.combining && !c.mode.includes?(".")}
cds.each do |c|
  if c.unicode.size > 1 && c.unicode.chars != c.unicode.chars.sort
    puts "sort unicode for #{c.tex} on line ${c.line}"
  end
end


config.each do |c|
  (c.mode == "" ? ["math", "text"] : [ c.mode ]).each{ |mode|
    ucode_mode = "#{c.unicode}\t#{mode}"
    puts "swap #{c.tex} with #{T2U[ucode_mode]}" if T2U.includes?(ucode_mode) && c.tex.match(/\\.+\\/)
  }

  if !c.combining && c.tex.match(/^((\\[^a-z][a-z])|(\\.{[a-z]}))$/i) && cds.find{|cd| c.unicode.ends_with?(cd.unicode)}
    puts "remove #{c.tex} on line #{c.line}"
  end
end

#InDegree.each do |k, deg|
#  next if deg <= 1
#  if k.match(/\t/)
#    # multiple unicode map to same tex construct
#    puts "stopgap #{k}"
#  else
#    # multiple tex 
#  end
#end
