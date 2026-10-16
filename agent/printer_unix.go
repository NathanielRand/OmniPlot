//go:build !windows

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// "device for Name: usb://Vendor/Model?serial=123"
var lpstatLine = regexp.MustCompile(`^device for (.+?): (\S+)`)

func listPrinters(all bool) ([]printerInfo, error) {
	var out []printerInfo

	// Linux kernel usblp nodes — a bare printer-class device with no CUPS queue.
	nodes, _ := filepath.Glob("/dev/usb/lp*")
	for _, n := range nodes {
		out = append(out, printerInfo{Name: n, Port: n, IsUSB: true, Kind: "usblp"})
	}

	// CUPS queues (macOS and most Linux desktops). A missing lpstat or "no
	// destinations" just means there are none — not an error.
	ctx, cancel := context.WithTimeout(context.Background(), printerJobTimeout())
	defer cancel()
	b, err := exec.CommandContext(ctx, "lpstat", "-v").Output()
	if err != nil {
		return out, nil
	}
	for _, line := range strings.Split(string(b), "\n") {
		m := lpstatLine.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		isUSB := strings.HasPrefix(m[2], "usb://")
		if !all && !isUSB {
			continue
		}
		out = append(out, printerInfo{Name: m[1], Port: m[2], IsUSB: isUSB, Kind: "cups"})
	}
	return out, nil
}

func writePrinterRaw(name string, data []byte) (int, error) {
	if strings.HasPrefix(name, "/dev/usb/lp") {
		f, err := os.OpenFile(name, os.O_WRONLY, 0)
		if err != nil {
			return 0, fmt.Errorf("cannot open %s: %w (is your user in the 'lp' group?)", name, err)
		}
		defer f.Close()
		return f.Write(data)
	}
	// -o raw: send bytes untouched, no filter. name was validated against lpstat.
	ctx, cancel := context.WithTimeout(context.Background(), printerJobTimeout())
	defer cancel()
	cmd := exec.CommandContext(ctx, "lp", "-d", name, "-o", "raw")
	cmd.Stdin = bytes.NewReader(data)
	if out, err := cmd.CombinedOutput(); err != nil {
		return 0, fmt.Errorf("lp failed on %q: %v: %s", name, err, strings.TrimSpace(string(out)))
	}
	return len(data), nil
}
