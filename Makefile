build: load
	mkdir -p tables
	./load

%: %.cr
	crystal build --release -o $@ $<
