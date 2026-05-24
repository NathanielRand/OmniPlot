BINARY   := omniplot-agent
VERSION  := $(shell grep 'const agentVersion' main.go | sed 's/.*"\(.*\)".*/\1/')
LDFLAGS  := -ldflags="-s -w"
DIST_DIR := ../static/downloads/agent/v$(VERSION)

.PHONY: build run dist dist-linux dist-windows dist-mac-arm dist-mac-intel windows mac-arm mac-intel linux all clean

build:
	go build -o bin/$(BINARY) .

run:
	go run . --verbose

# ── dist: build into static/downloads (what the web app serves) ──────────────
dist-linux:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-linux-amd64 .
	@echo "→ $(DIST_DIR)/$(BINARY)-linux-amd64"

dist-windows:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-windows-amd64.exe .
	@echo "→ $(DIST_DIR)/$(BINARY)-windows-amd64.exe"

# macOS requires CGO (IOKit) — must run on a macOS host or GitHub Actions macos runner
dist-mac-arm:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-arm64 .
	@echo "→ $(DIST_DIR)/$(BINARY)-darwin-arm64"

dist-mac-intel:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o $(DIST_DIR)/$(BINARY)-darwin-amd64 .
	@echo "→ $(DIST_DIR)/$(BINARY)-darwin-amd64"

# Linux host: can only build linux + windows without a Darwin cross-compiler
dist: dist-linux dist-windows
	@echo "macOS binaries require 'make dist-mac-arm dist-mac-intel' on macOS (or CI)"

# ── bin/: local dev binaries (gitignored) ────────────────────────────────────
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
