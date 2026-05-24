BINARY  := omniplot-agent
VERSION := $(shell grep 'const agentVersion' main.go | sed 's/.*"\(.*\)".*/\1/')
LDFLAGS := -ldflags="-s -w -X main.agentVersion=$(VERSION)"

.PHONY: build run windows mac-arm mac-intel linux all clean

build:
	go build -o bin/$(BINARY) .

run:
	go run . --verbose

# Cross-compiled release binaries
windows:
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-windows-amd64.exe .

mac-arm:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o bin/$(BINARY)-darwin-arm64 .

mac-intel:
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-darwin-amd64 .

linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/$(BINARY)-linux-amd64 .

all: windows mac-arm mac-intel linux

clean:
	rm -rf bin/
