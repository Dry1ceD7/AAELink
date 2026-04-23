package metrics

import (
	"net/http/httptest"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequests = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total HTTP requests handled by the service.",
		},
		[]string{"service", "method", "path", "status"},
	)

	httpDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"service", "method", "path"},
	)

	promH = promhttp.Handler()
)

func init() {
	prometheus.MustRegister(httpRequests, httpDuration)
}

func Middleware(service string) fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()

		path := "unknown"
		if r := c.Route(); r != nil && r.Path != "" {
			path = r.Path
		}
		method := c.Method()
		status := strconv.Itoa(c.Response().StatusCode())

		httpRequests.WithLabelValues(service, method, path, status).Inc()
		httpDuration.WithLabelValues(service, method, path).Observe(time.Since(start).Seconds())
		return err
	}
}

func Handler() fiber.Handler {
	return func(c fiber.Ctx) error {
		rw := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/metrics", nil)
		promH.ServeHTTP(rw, req)
		for k, vs := range rw.Header() {
			for _, v := range vs {
				c.Set(k, v)
			}
		}
		c.Status(rw.Code)
		return c.Send(rw.Body.Bytes())
	}
}
