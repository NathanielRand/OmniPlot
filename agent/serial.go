package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

// ─── Types ────────────────────────────────────

type cutRequest struct {
	HPGL   string    `json:"hpgl"`
	Config cutConfig `json:"config"`
}

type cutConfig struct {
	BaudRate   int    `json:"baudRate"`   // default 9600
	SerialPort string `json:"serialPort"` // "auto" | "COM3" | "/dev/ttyUSB0" | "/dev/cu.usbserial-*"
}

type cutResponse struct {
	OK           bool   `json:"ok"`
	BytesWritten int    `json:"bytesWritten"`
	Port         string `json:"port"`
}

type queryRequest struct {
	Command    string `json:"command"`
	SerialPort string `json:"serialPort"`
	BaudRate   int    `json:"baudRate"`
	TimeoutMs  int    `json:"timeoutMs"`
}

type queryResponse struct {
	OK       bool   `json:"ok"`
	Response string `json:"response"`
	Port     string `json:"port"`
}

type portInfo struct {
	Name         string `json:"name"`
	IsUSB        bool   `json:"isUSB"`
	VendorID     string `json:"vendorId,omitempty"`
	ProductID    string `json:"productId,omitempty"`
	Product      string `json:"product,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
}

// ─── Port manager ─────────────────────────────
// Keeps a single serial port open across requests so that:
//   - DTR stays asserted (high) between patterns — no mid-job plotter reset
//   - No open/close latency on consecutive segment requests
//   - No "port busy" races between /api/cut and /api/query
//
// The mutex is held for the ENTIRE duration of a send or query so that
// concurrent HTTP requests are serialized and never interleave bytes.
// Auto-releases after portIdleTimeout of inactivity.

const portIdleTimeout = 10 * time.Second

type portManager struct {
	mu       sync.Mutex
	port     serial.Port
	portName string
	baudRate int
	lastUsed time.Time
}

// Global singleton — all handlers share one port.
var pm = &portManager{}

// withPort acquires the port (opening or reusing) and calls fn with it.
// The mutex is held for the full duration of fn. On any error inside fn,
// the port is closed and cleared so the next call starts fresh.
func (m *portManager) withPort(portName string, baudRate int, fn func(serial.Port) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Open or reuse based on config match
	if m.port == nil || m.portName != portName || m.baudRate != baudRate {
		if m.port != nil {
			_ = m.port.Close()
			m.port = nil
		}
		mode := &serial.Mode{
			BaudRate: baudRate,
			DataBits: 8,
			Parity:   serial.NoParity,
			StopBits: serial.OneStopBit,
		}
		p, err := serial.Open(portName, mode)
		if err != nil {
			return fmt.Errorf("cannot open %s: %w", portName, err)
		}
		m.port = p
		m.portName = portName
		m.baudRate = baudRate
	}
	m.lastUsed = time.Now()

	if err := fn(m.port); err != nil {
		// Tear down on any I/O error — next request opens fresh
		_ = m.port.Close()
		m.port = nil
		return err
	}
	return nil
}

// release closes the port immediately and clears the manager.
// Called by /api/release-port and on agent shutdown.
func (m *portManager) release() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.port != nil {
		_ = m.port.Close()
		m.port = nil
	}
}

// releaseIfIdle closes the port only if it has been idle for at least d.
// Run periodically from a background goroutine.
func (m *portManager) releaseIfIdle(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.port != nil && time.Since(m.lastUsed) >= d {
		log.Printf("agent: serial port %s idle for %v — releasing", m.portName, d)
		_ = m.port.Close()
		m.port = nil
	}
}

// ─── /api/ports ───────────────────────────────

func handlePorts(w http.ResponseWriter, r *http.Request) {
	detailed, err := enumerator.GetDetailedPortsList()
	if err != nil {
		// Fall back to simple list if enumeration fails (e.g. Linux without udev)
		simple, sErr := serial.GetPortsList()
		if sErr != nil {
			jsonError(w, http.StatusInternalServerError,
				fmt.Sprintf("cannot enumerate ports: %v", err))
			return
		}
		result := make([]portInfo, len(simple))
		for i, name := range simple {
			result[i] = portInfo{Name: name}
		}
		jsonOK(w, result)
		return
	}

	result := make([]portInfo, 0, len(detailed))
	for _, p := range detailed {
		result = append(result, portInfo{
			Name:         p.Name,
			IsUSB:        p.IsUSB,
			VendorID:     p.VID,
			ProductID:    p.PID,
			Product:      p.Product,
			Manufacturer: p.Manufacturer,
		})
	}
	jsonOK(w, result)
}

// ─── /api/cut ─────────────────────────────────

func handleCut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}

	var req cutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		globalStats.recordError()
		bus.emit(AgentEvent{Type: EvtError, Method: "POST", Path: "/api/cut", Status: 400, Message: "invalid JSON: " + err.Error()})
		jsonError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.HPGL == "" {
		globalStats.recordError()
		bus.emit(AgentEvent{Type: EvtError, Method: "POST", Path: "/api/cut", Status: 400, Message: "hpgl field is required"})
		jsonError(w, http.StatusBadRequest, "hpgl field is required")
		return
	}

	if req.Config.BaudRate == 0 {
		req.Config.BaudRate = 9600
	}
	if req.Config.SerialPort == "" {
		req.Config.SerialPort = "auto"
	}

	start := time.Now()

	portName, err := resolvePort(req.Config.SerialPort)
	if err != nil {
		globalStats.recordError()
		bus.emit(AgentEvent{Type: EvtError, Method: "POST", Path: "/api/cut", Status: 422, Message: err.Error()})
		jsonError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	n, err := sendHPGL(portName, req.Config.BaudRate, req.HPGL)
	dur := time.Since(start)
	if err != nil {
		globalStats.recordError()
		bus.emit(AgentEvent{
			Type:       EvtError,
			Method:     "POST",
			Path:       "/api/cut",
			Status:     500,
			DurationMs: float64(dur.Milliseconds()),
			Port:       portName,
			Message:    err.Error(),
		})
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	globalStats.recordCut(portName, n)
	bus.emit(AgentEvent{
		Type:       EvtCut,
		Method:     "POST",
		Path:       "/api/cut",
		Status:     200,
		DurationMs: float64(dur.Milliseconds()),
		Bytes:      n,
		Port:       portName,
	})

	jsonOK(w, cutResponse{OK: true, BytesWritten: n, Port: portName})
}

// ─── /api/release-port ────────────────────────
// Explicitly releases the persistent serial port so it can be claimed by
// other software or re-opened with different settings.
// Call from the web app on explicit disconnect or before a port reconfiguration.

func handleReleasePort(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	released := pm.portName // capture before release clears it
	pm.release()
	msg := "serial port released"
	if released != "" {
		msg = fmt.Sprintf("serial port %s released", released)
	}
	bus.emit(AgentEvent{Type: EvtInfo, Method: "POST", Path: "/api/release-port", Status: 200, Message: msg})
	jsonOK(w, map[string]bool{"ok": true})
}

// ─── Port resolution ──────────────────────────

func resolvePort(name string) (string, error) {
	if name != "" && name != "auto" {
		return name, nil
	}

	detailed, err := enumerator.GetDetailedPortsList()
	if err == nil {
		for _, p := range detailed {
			if p.IsUSB {
				return p.Name, nil
			}
		}
		if len(detailed) > 0 {
			return detailed[0].Name, nil
		}
	}

	simple, err := serial.GetPortsList()
	if err != nil || len(simple) == 0 {
		return "", fmt.Errorf("no serial ports found — is the cutter connected and powered on?")
	}
	return simple[0], nil
}

// ─── /api/query ───────────────────────────────
// Bidirectional serial: writes a command and reads back the response.
// Uses the port manager so the port stays open between cut and query calls,
// and so a timed-out query cannot leave the port stuck open.

func handleQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}

	var req queryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.Command == "" {
		jsonError(w, http.StatusBadRequest, "command required")
		return
	}
	if req.TimeoutMs <= 0 {
		req.TimeoutMs = 3000
	}
	if req.BaudRate == 0 {
		req.BaudRate = 9600
	}
	if req.SerialPort == "" {
		req.SerialPort = "auto"
	}

	portName, err := resolvePort(req.SerialPort)
	if err != nil {
		jsonError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	response, err := querySerial(portName, req.BaudRate, req.Command, req.TimeoutMs)
	if err != nil {
		bus.emit(AgentEvent{Type: EvtError, Method: "POST", Path: "/api/query", Status: 500, Port: portName, Message: err.Error()})
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	bus.emit(AgentEvent{Type: EvtInfo, Method: "POST", Path: "/api/query", Status: 200, Port: portName, Message: "query: " + strings.TrimSpace(req.Command)})
	jsonOK(w, queryResponse{OK: true, Response: response, Port: portName})
}

// ─── Serial operations ────────────────────────
// Both sendHPGL and querySerial go through pm.withPort so that:
//   - The port stays open between calls (DTR held high, no reset)
//   - Concurrent requests are serialized (no interleaved bytes)
//   - An I/O error releases the port cleanly for the next attempt

func sendHPGL(portName string, baudRate int, hpgl string) (int, error) {
	total := 0
	err := pm.withPort(portName, baudRate, func(port serial.Port) error {
		data := []byte(hpgl)
		const chunk = 4096
		for len(data) > 0 {
			end := chunk
			if end > len(data) {
				end = len(data)
			}
			n, err := port.Write(data[:end])
			total += n
			if err != nil {
				return fmt.Errorf("write error after %d bytes on %s: %w", total, portName, err)
			}
			data = data[end:]
		}
		// Drain: wait for the OS kernel TX buffer to flush into the USB chip.
		// Critical: without this, the kernel may discard buffered bytes if the
		// port is later closed before physical transmission completes.
		if err := port.Drain(); err != nil {
			log.Printf("agent: drain warning on %s: %v (job may be incomplete)", portName, err)
		}
		return nil
	})
	if err != nil {
		return total, err
	}
	return total, nil
}

// querySerial sends command and reads until a response terminator or timeout.
// 100 ms read slices let the outer deadline interrupt cleanly.
func querySerial(portName string, baudRate int, command string, timeoutMs int) (string, error) {
	var response string
	err := pm.withPort(portName, baudRate, func(port serial.Port) error {
		if err := port.SetReadTimeout(100 * time.Millisecond); err != nil {
			// Non-fatal: some platforms don't support per-read timeouts
			log.Printf("agent: SetReadTimeout warning: %v", err)
		}

		if _, err := port.Write([]byte(command)); err != nil {
			return fmt.Errorf("write error on %s: %w", portName, err)
		}

		var buf []byte
		deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
		tmp := make([]byte, 256)

		for time.Now().Before(deadline) {
			n, _ := port.Read(tmp)
			if n > 0 {
				buf = append(buf, tmp[:n]...)
				s := string(buf)
				if strings.ContainsAny(s, "\r\n") || strings.HasSuffix(strings.TrimRight(s, " "), ";") {
					break
				}
			}
		}

		response = strings.TrimSpace(string(buf))
		return nil
	})
	return response, err
}
