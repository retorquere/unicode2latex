.PHONY: all clean

TARGETS = tables/biblatex.ts tables/bibtex.ts tables/combining.ts tables/latex2unicode.ts tables/minimal.ts

all: $(TARGETS)

tables/%.ts: ./build.js config.ssv
	./build.js

clean:
	rm -f $(TARGETS)
