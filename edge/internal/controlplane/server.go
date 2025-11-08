package controlplane

import (
    "context"
    "encoding/json"
    "log"
    "net"
    "net/http"
    "time"

    "github.com/gorilla/websocket"
    "google.golang.org/grpc"
    "google.golang.org/grpc/encoding"
    "google.golang.org/grpc/reflection"
    "google.golang.org/protobuf/types/known/emptypb"

    "github.com/payhole/edge/internal/filter"
    "github.com/payhole/edge/internal/metrics"
)

type UnlockRequest struct {
    ClientIP  string `json:"clientIp"`
    ExpiresAt string `json:"expiresAt"`
}

type jsonCodec struct{}

func (jsonCodec) Marshal(v interface{}) ([]byte, error) { return json.Marshal(v) }
func (jsonCodec) Unmarshal(data []byte, v interface{}) error { return json.Unmarshal(data, v) }
func (jsonCodec) Name() string { return "json" }

type UnlockServiceServer interface {
    PushUnlock(context.Context, *UnlockRequest) (*emptypb.Empty, error)
}

type unlockServer struct {
    filter  *filter.Filter
    metrics *metrics.Collector
}

func NewServer(f *filter.Filter, m *metrics.Collector) *unlockServer {
    return &unlockServer{filter: f, metrics: m}
}

func (s *unlockServer) PushUnlock(ctx context.Context, req *UnlockRequest) (*emptypb.Empty, error) {
    s.apply(req)
    return &emptypb.Empty{}, nil
}

func (s *unlockServer) apply(req *UnlockRequest) {
    if req == nil {
        return
    }
    expiry := time.Now().Add(30 * time.Minute)
    if req.ExpiresAt != "" {
        if ts, err := time.Parse(time.RFC3339, req.ExpiresAt); err == nil {
            expiry = ts
        }
    }
    s.filter.Authorize(req.ClientIP, expiry)
    if s.metrics != nil {
        s.metrics.SetPremiumSessions(s.filter.AuthorizedCount())
    }
}

func (s *unlockServer) RegisterGRPC(grpcAddr string) error {
    if grpcAddr == "" {
        return nil
    }
    lis, err := net.Listen("tcp", grpcAddr)
    if err != nil {
        return err
    }
    encoding.RegisterCodec(jsonCodec{})
    srv := grpc.NewServer(grpc.ForceServerCodec(jsonCodec{}))
    RegisterUnlockServiceServer(srv, s)
    reflection.Register(srv)
    go func() {
        log.Printf("control plane gRPC listening on %s", grpcAddr)
        if err := srv.Serve(lis); err != nil {
            log.Printf("grpc server stopped: %v", err)
        }
    }()
    return nil
}

func (s *unlockServer) RegisterWebsocket(addr string) error {
    if addr == "" {
        return nil
    }
    upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
    mux := http.NewServeMux()
    mux.HandleFunc("/control/unlock", func(w http.ResponseWriter, r *http.Request) {
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
            log.Printf("websocket upgrade failed: %v", err)
            return
        }
        defer conn.Close()
        for {
            _, data, err := conn.ReadMessage()
            if err != nil {
                return
            }
            var req UnlockRequest
            if err := json.Unmarshal(data, &req); err != nil {
                log.Printf("invalid unlock payload: %v", err)
                continue
            }
            s.apply(&req)
        }
    })

    go func() {
        log.Printf("control plane websocket listening on %s", addr)
        if err := http.ListenAndServe(addr, mux); err != nil {
            log.Printf("websocket server stopped: %v", err)
        }
    }()
    return nil
}

func (s *unlockServer) SetMetricsGauge() {
    if s.metrics != nil {
        s.metrics.SetPremiumSessions(s.filter.AuthorizedCount())
    }
}
