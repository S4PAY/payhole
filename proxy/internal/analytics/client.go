package analytics

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// Event represents a blocked request telemetry item.
type Event struct {
	Domain    string    `json:"domain"`
	Reason    string    `json:"reason"`
	Timestamp time.Time `json:"timestamp"`
}

// Client posts analytics events to an HTTP endpoint.
type Client struct {
	endpoint string
	client   *http.Client
}

// NewClient initialises an analytics client. When endpoint is empty the client is disabled.
func NewClient(endpoint string) *Client {
	return &Client{
		endpoint: endpoint,
		client: &http.Client{
			Timeout: 3 * time.Second,
		},
	}
}

// Enabled returns true when analytics submission is active.
func (c *Client) Enabled() bool {
	return c != nil && c.endpoint != ""
}

// RecordBlocked publishes a blocked request event. Failures are silent to avoid impacting the hot path.
func (c *Client) RecordBlocked(domain, reason string) {
	if !c.Enabled() {
		return
	}

	event := Event{
		Domain:    domain,
		Reason:    reason,
		Timestamp: time.Now().UTC(),
	}

	payload, err := json.Marshal(event)
	if err != nil {
		return
	}

	req, err := http.NewRequest(http.MethodPost, c.endpoint, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	go func() {
		resp, err := c.client.Do(req)
		if err != nil {
			return
		}
		_ = resp.Body.Close()
	}()
}

