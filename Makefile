tables: build
	mkdir -p tables
	#./load
	#./sanity
	./build

%: %.cr
	crystal build --no-debug --release -o $@ $<
