// OmniPlot Cut Agent
//
// Lightweight HTTP daemon that runs on the user's machine and bridges
// the OmniPlot web app to a USB/serial vinyl cutter.
//
// Protocol: see plotter-connection.ts in the web app source.
//
// Usage:
//   ./omniplot-agent                  # listen on default port 7878
//   ./omniplot-agent --port 7879      # custom port
//   ./omniplot-agent --verbose        # log every request
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const agentVersion = "1.1.0"

func main() {
	port    := flag.Int("port", 7878, "HTTP port to listen on (default 7878)")
	verbose := flag.Bool("verbose", false, "log every request")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/status",       withCORS(handleStatus))
	mux.HandleFunc("/api/ports",        withCORS(handlePorts))
	mux.HandleFunc("/api/cut",          withCORS(handleCut))
	mux.HandleFunc("/api/query",        withCORS(handleQuery))
	mux.HandleFunc("/api/events",       withCORS(handleEvents))
	mux.HandleFunc("/api/stats",        withCORS(handleStats))
	mux.HandleFunc("/api/shutdown",     withCORS(handleShutdown))
	mux.HandleFunc("/api/network-scan", withCORS(handleNetworkScan))
	// Catch-all: handle CORS preflight for any path
	mux.HandleFunc("/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		jsonError(w, http.StatusNotFound, "not found")
	}))

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	srv  := &http.Server{
		Addr:         addr,
		Handler:      observeMiddleware(logMiddleware(mux, *verbose)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 120 * time.Second, // covers serial drain for large jobs at 9600 baud
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("agent: server error: %v", err)
		}
	}()

	// Emit startup JSON to stdout — the web app (and shell scripts) can read this.
	startup := map[string]any{
		"agent":   "omniplot-cut-agent",
		"version": agentVersion,
		"port":    *port,
		"pid":     os.Getpid(),
	}
	_ = json.NewEncoder(os.Stdout).Encode(startup)
	log.Printf("OmniPlot Cut Agent v%s listening on http://%s", agentVersion, addr)

	bus.emit(AgentEvent{
		Type:    EvtInfo,
		Message: fmt.Sprintf("OmniPlot Cut Agent v%s started on http://%s", agentVersion, addr),
	})

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-stop:
	case <-shutdownCh:
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("agent: shut down cleanly")
}

// ─── Middleware ───────────────────────────────

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}

func logMiddleware(next http.Handler, verbose bool) http.Handler {
	if !verbose {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
	})
}

// ─── Helpers ──────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// ─── /api/status ──────────────────────────────

func handleStatus(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]any{
		"agent":   "omniplot-cut-agent",
		"version": agentVersion,
		"ok":      true,
	})
}
