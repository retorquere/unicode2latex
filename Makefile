# Name of the binary
TARGET = build

# All Crystal source files in the current directory
SRCS = $(wildcard *.cr)

# Default target
all: $(TARGET)

# Build the binary if any source changes
$(TARGET): $(SRCS)
	crystal build $(SRCS) -o $(TARGET)

# Optional: clean up
clean:
	rm -f $(TARGET)
