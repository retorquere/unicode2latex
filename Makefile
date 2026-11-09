.PHONY: all clean

TARGETS = tables/biblatex.ts tables/bibtex.ts tables/combining.ts tables/latex2unicode.ts tables/minimal.ts

all: $(TARGETS)

tables/%.ts: Cargo.toml src/bin/rebuild.rs config.ssv
	cargo run

clean:
	rm -f $(TARGETS)
