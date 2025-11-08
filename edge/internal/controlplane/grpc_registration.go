package controlplane

import (
    "context"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
    "google.golang.org/protobuf/types/known/emptypb"
)

func RegisterUnlockServiceServer(s *grpc.Server, srv UnlockServiceServer) {
    s.RegisterService(&grpc.ServiceDesc{
        ServiceName: "controlplane.UnlockService",
        HandlerType: (*UnlockServiceServer)(nil),
        Methods: []grpc.MethodDesc{{
            MethodName: "PushUnlock",
            Handler: func(server interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
                in := new(UnlockRequest)
                if err := dec(in); err != nil {
                    return nil, err
                }
                if interceptor == nil {
                    return server.(UnlockServiceServer).PushUnlock(ctx, in)
                }
                info := &grpc.UnaryServerInfo{
                    Server:     server,
                    FullMethod: "/controlplane.UnlockService/PushUnlock",
                }
                handler := func(ctx context.Context, req interface{}) (interface{}, error) {
                    return server.(UnlockServiceServer).PushUnlock(ctx, req.(*UnlockRequest))
                }
                return interceptor(ctx, in, info, handler)
            },
        }},
        Streams:  []grpc.StreamDesc{},
        Metadata: "unlock.proto",
    }, srv)
}

type UnimplementedUnlockServiceServer struct{}

func (UnimplementedUnlockServiceServer) PushUnlock(context.Context, *UnlockRequest) (*emptypb.Empty, error) {
    return nil, status.Errorf(codes.Unimplemented, "method PushUnlock not implemented")
}
