tables: build config.ssv
	mkdir -p tables
	./build

%: %.cr
	crystal build --no-debug --release -o $@ $<
