package classifier

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Request struct {
	RequestID   string             `json:"requestId"`
	Domain      string             `json:"domain"`
	RiskScore   float64            `json:"riskScore,omitempty"`
	Numerical   map[string]float64 `json:"numerical,omitempty"`
	Categorical map[string]string  `json:"categorical,omitempty"`
}

type Response struct {
	RequestID    string  `json:"requestId"`
	Score        float64 `json:"score"`
	Label        string  `json:"label"`
	ModelVersion string  `json:"modelVersion"`
}

type Client struct {
	endpoint string
	http     *http.Client
}

func NewClient(endpoint string) *Client {
	return NewClientWithHTTP(endpoint, nil)
}

func NewClientWithHTTP(endpoint string, httpClient *http.Client) *Client {
	if endpoint == "" {
		return nil
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 2 * time.Second}
	}
	return &Client{
		endpoint: endpoint,
		http:     httpClient,
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.endpoint != ""
}

func (c *Client) Predict(ctx context.Context, req Request) (Response, error) {
	if !c.Enabled() {
		return Response{Label: "allow", Score: 0}, nil
	}
	body, err := json.Marshal(req)
	if err != nil {
		return Response{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Response{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return Response{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return Response{}, fmt.Errorf("classifier returned status %d", resp.StatusCode)
	}
	var out Response
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return Response{}, err
	}
	return out, nil
}
