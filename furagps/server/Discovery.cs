using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

static class LanDiscovery {
    public static bool IsLocal(IPAddress address){var bytes=address.GetAddressBytes();return bytes.Length==4&&(bytes[0]==10||bytes[0]==127||bytes[0]==192&&bytes[1]==168||bytes[0]==172&&bytes[1]>=16&&bytes[1]<=31||bytes[0]==169&&bytes[1]==254);}
    public static async Task Run(int httpPort,int discoveryPort,CancellationToken cancel) {
        try {
            using var socket=new UdpClient(new IPEndPoint(IPAddress.Any,discoveryPort));long last=0;
            while(!cancel.IsCancellationRequested) {
                var packet=await socket.ReceiveAsync(cancel);bool local=IsLocal(packet.RemoteEndPoint.Address);
                if(!local||packet.Buffer.Length!=8||Encoding.ASCII.GetString(packet.Buffer)!="FURAGPS?"||Environment.TickCount64-last<40)continue;
                last=Environment.TickCount64;
                var reply=JsonSerializer.SerializeToUtf8Bytes(new {service="furagps",port=httpPort,version="0.11.0",name=Environment.MachineName});
                await socket.SendAsync(reply,packet.RemoteEndPoint,cancel);
            }
        }catch(OperationCanceledException)when(cancel.IsCancellationRequested){}catch(SocketException){Console.WriteLine("LAN discovery unavailable; connect using the PC IP address.");}
    }
}
