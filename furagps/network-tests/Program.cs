using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using var cancellation=new CancellationTokenSource();
foreach(var value in new[]{"192.168.1.3","10.0.0.4","172.16.0.1","172.31.255.255","127.0.0.1","169.254.1.1"})if(!LanDiscovery.IsLocal(IPAddress.Parse(value)))throw new Exception("LAN address rejected");
foreach(var value in new[]{"8.8.8.8","172.15.0.1","172.32.0.1","::1","2001:db8::1"})if(LanDiscovery.IsLocal(IPAddress.Parse(value)))throw new Exception("Non-LAN address accepted");
using(var probe=new UdpClient(new IPEndPoint(IPAddress.Loopback,0))){int port=((IPEndPoint)probe.Client.LocalEndPoint!).Port;probe.Close();
 var run=LanDiscovery.Run(28889,port,cancellation.Token);using var client=new UdpClient(new IPEndPoint(IPAddress.Loopback,0));
 await client.SendAsync(Encoding.ASCII.GetBytes("FURAGPS?"),new IPEndPoint(IPAddress.Loopback,port));
 using var timeout=new CancellationTokenSource(2000);var reply=await client.ReceiveAsync(timeout.Token);using var data=JsonDocument.Parse(reply.Buffer);
 if(data.RootElement.GetProperty("service").GetString()!="furagps"||data.RootElement.GetProperty("port").GetInt32()!=28889)throw new Exception("Discovery reply invalid");
 await Task.Delay(50);await client.SendAsync(Encoding.ASCII.GetBytes("INVALID?"),new IPEndPoint(IPAddress.Loopback,port));
 using var shortTimeout=new CancellationTokenSource(200);try{await client.ReceiveAsync(shortTimeout.Token);throw new Exception("Invalid query was answered");}catch(OperationCanceledException){}
 cancellation.Cancel();await run;}
Console.WriteLine("PASS: real UDP LAN discovery returns the HTTP port and ignores invalid queries on an isolated ephemeral port.");
