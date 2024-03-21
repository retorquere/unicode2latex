tables: build
	mkdir -p tables
	./build

%: %.cr
	crystal build --no-debug --release -o $@ $<
