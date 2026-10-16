package main

// Printer-class USB cutters.
//
// Some cutters (many Graphtec, Roland CAMM-1, GCC and Summa models) enumerate
// as a USB *printer*, not a serial adapter, so no COM port / tty ever appears.
// The OS exposes them as a print queue (Windows spooler, CUPS) or a raw
// /dev/usb/lpN node. We send HPGL to them as a RAW print job — the spooler or
// kernel handles USB flow control, so the buffer-overrun problem of a bare
// serial write doesn't apply.
//
// One-way only: a print queue can't read data back, so position queries (OA)
// are unavailable on these devices.
//
// A printer is addressed by `serialPort: "printer:<name>"` on /api/cut.

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const printerPrefix = "printer:"

type printerInfo struct {
	Name   string `json:"name"`             // spooler/CUPS queue name, or /dev/usb/lpN
	Port   string `json:"port,omitempty"`   // USB001, usb://Vendor/Model…
	Driver string `json:"driver,omitempty"` // Windows driver name
	IsUSB  bool   `json:"isUSB"`
	Kind   string `json:"kind"` // "spooler" | "cups" | "usblp"
}

// printerSelector returns the queue name when sel addresses a printer.
func printerSelector(sel string) (string, bool) {
	if !strings.HasPrefix(sel, printerPrefix) {
		return "", false
	}
	name := strings.TrimSpace(strings.TrimPrefix(sel, printerPrefix))
	return name, name != ""
}

// One print job at a time: interleaved jobs would interleave HPGL.
var printerMu sync.Mutex

// sendRawToPrinter validates the target against the live printer list (so the
// agent can only ever write to a real printer queue, never an arbitrary path
// or command argument) and sends data as a RAW job.
func sendRawToPrinter(name string, data []byte) (int, error) {
	printers, err := listPrinters(true)
	if err != nil {
		return 0, fmt.Errorf("cannot list printers: %w", err)
	}
	found := false
	for _, p := range printers {
		if p.Name == name {
			found = true
			break
		}
	}
	if !found {
		return 0, fmt.Errorf("printer %q not found — is the cutter plugged in and powered on?", name)
	}
	printerMu.Lock()
	defer printerMu.Unlock()
	return writePrinterRaw(name, data)
}

// ─── /api/printers ────────────────────────────

func handlePrinters(w http.ResponseWriter, r *http.Request) {
	// ?all=1 includes non-USB queues (PDF writers, network printers).
	all := r.URL.Query().Get("all") == "1"
	list, err := listPrinters(all)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("cannot list printers: %v", err))
		return
	}
	if list == nil {
		list = []printerInfo{}
	}
	jsonOK(w, list)
}

func printerJobTimeout() time.Duration { return 60 * time.Second }
