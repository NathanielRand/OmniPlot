package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// ─── Event types ──────────────────────────────

const (
	EvtRequest = "request"
	EvtCut     = "cut"
	EvtError   = "error"
	EvtInfo    = "info"
)

type AgentEvent struct {
	Time       string  `json:"time"`
	Type       string  `json:"type"`
	Method     string  `json:"method,omitempty"`
	Path       string  `json:"path,omitempty"`
	Status     int     `json:"status,omitempty"`
	DurationMs float64 `json:"durationMs,omitempty"`
	Bytes      int     `json:"bytes,omitempty"`
	Port       string  `json:"port,omitempty"`
	Message    string  `json:"message,omitempty"`
}

// ─── SSE Broadcaster ──────────────────────────

type broadcaster struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

var bus = &broadcaster{clients: make(map[chan string]struct{})}

func (b *broadcaster) subscribe() chan string {
	ch := make(chan string, 64)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *broadcaster) unsubscribe(ch chan string) {
	b.mu.Lock()
	delete(b.clients, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *broadcaster) emit(e AgentEvent) {
	if e.Time == "" {
		e.Time = time.Now().UTC().Format(time.RFC3339Nano)
	}
	data, _ := json.Marshal(e)
	line := "data: " + string(data) + "\n\n"
	b.mu.Lock()
	for ch := range b.clients {
		select {
		case ch <- line:
		default: // drop for slow clients; buffer is 64 events
		}
	}
	b.mu.Unlock()
}

// ─── Response recorder ────────────────────────
// Captures status + byte count so the observe middleware can report them.

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *responseRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// ─── Observe middleware ───────────────────────
// Emits an SSE event for every request except /api/events (would be recursive)
// and /api/cut (handleCut emits its own richer event with cutter-specific details).

func observeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/events" || r.URL.Path == "/api/cut" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()
		rec := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		dur := time.Since(start)

		evtType := EvtRequest
		if rec.status >= 400 {
			evtType = EvtError
		}

		bus.emit(AgentEvent{
			Type:       evtType,
			Method:     r.Method,
			Path:       r.URL.Path,
			Status:     rec.status,
			DurationMs: float64(dur.Milliseconds()),
			Bytes:      rec.bytes,
		})
	})
}

// ─── /api/events ──────────────────────────────

func handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		jsonError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if present

	ch := bus.subscribe()
	defer bus.unsubscribe(ch)

	// 25s heartbeat keeps the connection alive through proxies
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case line, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprint(w, line)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
