package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
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

	// Apply defaults
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

// ─── Port resolution ──────────────────────────
// "auto" picks the first USB-serial port, falling back to the first available.
// An explicit name is passed through unchanged (validated by the OS on open).

func resolvePort(name string) (string, error) {
	if name != "" && name != "auto" {
		return name, nil
	}

	detailed, err := enumerator.GetDetailedPortsList()
	if err == nil {
		// Prefer USB ports — vinyl cutters are almost always USB-serial
		for _, p := range detailed {
			if p.IsUSB {
				return p.Name, nil
			}
		}
		if len(detailed) > 0 {
			return detailed[0].Name, nil
		}
	}

	// Last resort: simple list (no USB metadata)
	simple, err := serial.GetPortsList()
	if err != nil || len(simple) == 0 {
		return "", fmt.Errorf("no serial ports found — is the cutter connected and powered on?")
	}
	return simple[0], nil
}

// ─── /api/query ───────────────────────────────
// Bidirectional serial: sends a command string to the plotter and reads back
// the response. Used for HPGL queries such as OA (Output Actual Position)
// during roll-alignment calibration.

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

// querySerial opens portName, writes command, then reads until a response
// terminator (\r, \n, or trailing ;) is seen or timeoutMs elapses.
// Uses 100 ms read slices so the outer deadline can interrupt cleanly.
func querySerial(portName string, baudRate int, command string, timeoutMs int) (string, error) {
	mode := &serial.Mode{
		BaudRate: baudRate,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
	}
	port, err := serial.Open(portName, mode)
	if err != nil {
		return "", fmt.Errorf("cannot open %s: %w", portName, err)
	}
	defer port.Close()

	// Short per-read timeout so we can check the overall deadline between slices.
	port.SetReadTimeout(100 * time.Millisecond)

	if _, err := port.Write([]byte(command)); err != nil {
		return "", fmt.Errorf("write error on %s: %w", portName, err)
	}

	var buf []byte
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	tmp := make([]byte, 256)

	for time.Now().Before(deadline) {
		n, _ := port.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			s := string(buf)
			// Common HPGL response terminators: CR, LF, or trailing semicolon
			if strings.ContainsAny(s, "\r\n") || strings.HasSuffix(strings.TrimRight(s, " "), ";") {
				break
			}
		}
	}

	return strings.TrimSpace(string(buf)), nil
}

// ─── Serial write ─────────────────────────────
// Opens the port, writes HPGL in 4 KB chunks, drains the OS TX buffer, then
// closes. Drain is critical: close() on a TTY does NOT wait for the kernel
// serial TX buffer to empty, so patterns beyond the first are discarded if
// the buffer hasn't been physically transmitted before the FD is released.

func sendHPGL(portName string, baudRate int, hpgl string) (int, error) {
	mode := &serial.Mode{
		BaudRate: baudRate,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
	}

	port, err := serial.Open(portName, mode)
	if err != nil {
		return 0, fmt.Errorf("cannot open %s: %w", portName, err)
	}
	defer port.Close()

	data := []byte(hpgl)
	const chunk = 4096
	total := 0

	for len(data) > 0 {
		end := chunk
		if end > len(data) {
			end = len(data)
		}
		n, err := port.Write(data[:end])
		total += n
		if err != nil {
			return total, fmt.Errorf("write error after %d bytes on %s: %w", total, portName, err)
		}
		data = data[end:]
	}

	// Block until every byte in the OS serial TX buffer has been physically
	// transmitted to the cutter. Without this, Close() discards buffered data
	// and the cutter only sees the first pattern of a multi-pattern job.
	if err := port.Drain(); err != nil {
		log.Printf("agent: drain warning on %s: %v (job may be incomplete)", portName, err)
	}

	return total, nil
}
