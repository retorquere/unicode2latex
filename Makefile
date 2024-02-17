build: load sanity
	mkdir -p tables
	./load
	./sanity

%: %.cr
	crystal build --release -o $@ $<
