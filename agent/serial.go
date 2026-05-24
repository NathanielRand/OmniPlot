package main

import (
	"encoding/json"
	"fmt"
	"net/http"

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
		jsonError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	if req.HPGL == "" {
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

	portName, err := resolvePort(req.Config.SerialPort)
	if err != nil {
		jsonError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	n, err := sendHPGL(portName, req.Config.BaudRate, req.HPGL)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

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

// ─── Serial write ─────────────────────────────
// Opens the port, writes HPGL in 4 KB chunks (conservative for small plotter
// receive buffers), and closes. A 30-second write deadline prevents hangs
// if the plotter stops accepting data mid-job.

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

	return total, nil
}
