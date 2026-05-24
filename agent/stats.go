package main

import (
	"net/http"
	"sync"
	"time"
)

// ─── Stats ────────────────────────────────────

type agentStats struct {
	mu          sync.Mutex
	jobsTotal   int64
	jobsToday   int64
	bytesTotal  int64
	errorsTotal int64
	ports       map[string]int64
	startedAt   time.Time
	todayStr    string
}

var globalStats = &agentStats{
	ports:     make(map[string]int64),
	startedAt: time.Now(),
	todayStr:  time.Now().UTC().Format("2006-01-02"),
}

func (s *agentStats) recordCut(port string, bytes int) {
	today := time.Now().UTC().Format("2006-01-02")
	s.mu.Lock()
	defer s.mu.Unlock()
	if today != s.todayStr {
		s.todayStr = today
		s.jobsToday = 0
	}
	s.jobsTotal++
	s.jobsToday++
	s.bytesTotal += int64(bytes)
	if port != "" {
		s.ports[port]++
	}
}

func (s *agentStats) recordError() {
	s.mu.Lock()
	s.errorsTotal++
	s.mu.Unlock()
}

func (s *agentStats) snapshot() map[string]any {
	today := time.Now().UTC().Format("2006-01-02")
	s.mu.Lock()
	defer s.mu.Unlock()
	if today != s.todayStr {
		s.todayStr = today
		s.jobsToday = 0
	}
	ports := make([]string, 0, len(s.ports))
	for p := range s.ports {
		ports = append(ports, p)
	}
	return map[string]any{
		"jobsTotal":     s.jobsTotal,
		"jobsToday":     s.jobsToday,
		"bytesTotal":    s.bytesTotal,
		"errorsTotal":   s.errorsTotal,
		"portsUsed":     ports,
		"portsCount":    int64(len(s.ports)),
		"uptimeSeconds": time.Since(s.startedAt).Seconds(),
		"startedAt":     s.startedAt.UTC().Format(time.RFC3339),
	}
}

// ─── /api/stats ───────────────────────────────

func handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	jsonOK(w, globalStats.snapshot())
}

// ─── /api/shutdown ────────────────────────────

func handleShutdown(w http.ResponseWriter, _ *http.Request) {
	jsonOK(w, map[string]string{"status": "shutting down"})

	bus.emit(AgentEvent{
		Type:    EvtInfo,
		Message: "Agent shutting down on browser request.",
	})

	// Flush response before we exit
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	go func() {
		time.Sleep(100 * time.Millisecond)
		shutdownCh <- struct{}{}
	}()
}

// shutdownCh is written by handleShutdown and read by main().
var shutdownCh = make(chan struct{}, 1)
