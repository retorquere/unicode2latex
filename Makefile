tables/%.json: build config.ssv
	mkdir -p tables
	./build

.PHONY: all

all: tables/biblatex.json tables/bibtex.json tables/combining.json tables/latex2unicode.json tables/minimal.json

%: %.cr
	crystal build --no-debug --release -o $@ $<
