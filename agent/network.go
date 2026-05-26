// network.go — /api/network-scan
//
// Probes the local /24 subnet for devices listening on common plotter ports:
//   9100 — HP JetDirect (Roland, Graphtec, Summa, most network plotters)
//   5000 — Some Graphtec and Roland network interface models
//
// Uses concurrent TCP dial probes (up to 60 goroutines) with a short timeout.
// A full /24 scan with 2 ports typically completes in 3–8 seconds.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type discoveredDevice struct {
	IP         string `json:"ip"`
	Port       int    `json:"port"`
	ResponseMs int64  `json:"responseMs"`
}

// getLocalIP returns the machine's primary outbound IPv4 address by routing
// a UDP packet to a public address (no data is actually sent).
func getLocalIP() net.IP {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.To4()
}

// tcpProbe attempts a TCP connect to addr. Returns elapsed ms, or -1 on failure.
func tcpProbe(addr string, timeout time.Duration) int64 {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return -1
	}
	conn.Close()
	return time.Since(start).Milliseconds()
}

// handleNetworkScan scans the local /24 subnet for plotter-compatible devices.
// GET /api/network-scan
func handleNetworkScan(w http.ResponseWriter, r *http.Request) {
	localIP := getLocalIP()
	if localIP == nil {
		jsonError(w, http.StatusInternalServerError,
			"cannot determine local network interface")
		return
	}

	parts := strings.Split(localIP.String(), ".")
	if len(parts) != 4 {
		jsonError(w, http.StatusInternalServerError, "unexpected IP format")
		return
	}
	prefix := strings.Join(parts[:3], ".")

	// Common plotter network ports
	plotterPorts := []int{9100, 5000}

	const (
		dialTimeout = 400 * time.Millisecond
		concurrency = 60
	)

	var (
		mu      sync.Mutex
		results []discoveredDevice
		sem     = make(chan struct{}, concurrency)
		wg      sync.WaitGroup
	)

	for host := 1; host <= 254; host++ {
		ip := fmt.Sprintf("%s.%d", prefix, host)
		if ip == localIP.String() {
			continue // skip self
		}
		for _, p := range plotterPorts {
			addr := fmt.Sprintf("%s:%d", ip, p)
			port := p
			sem <- struct{}{}
			wg.Add(1)
			go func(a, ipStr string, pt int) {
				defer wg.Done()
				defer func() { <-sem }()
				ms := tcpProbe(a, dialTimeout)
				if ms >= 0 {
					mu.Lock()
					results = append(results, discoveredDevice{
						IP: ipStr, Port: pt, ResponseMs: ms,
					})
					mu.Unlock()
				}
			}(addr, ip, port)
		}
	}

	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	if results == nil {
		results = []discoveredDevice{}
	}
	_ = json.NewEncoder(w).Encode(results)
}
