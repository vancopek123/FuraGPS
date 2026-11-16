using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.AspNetCore.StaticFiles;

Directory.SetCurrentDirectory(AppContext.BaseDirectory);
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
var port = int.TryParse(Environment.GetEnvironmentVariable("FURAGPS_PORT"), out var customPort) ? customPort : 28888;
var bindAddress=Environment.GetEnvironmentVariable("FURAGPS_LOOPBACK")=="1"?"127.0.0.1":"0.0.0.0";
builder.WebHost.UseUrls($"http://{bindAddress}:{port}");
builder.Services.AddResponseCompression();
var app = builder.Build();
if(bindAddress!="127.0.0.1")_=LanDiscovery.Run(port,28890,app.Lifetime.ApplicationStopping);
var telemetry = new TelemetryReceiver(int.TryParse(Environment.GetEnvironmentVariable("FURAGPS_UDP_PORT"), out var udpPort) ? udpPort : 28887);
Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.Title = "Fura GPS · ETS2 + ATS";
Console.WriteLine("\n  FURA GPS  /  ETS2 + ATS  /  0.11.1\n");
var catalog=new GameCatalog(Path.Combine(AppContext.BaseDirectory,"data"),()=>telemetry.Snapshot().Data.Game);
_ = telemetry.Run();
foreach(var profile in catalog.Games.Where(g=>g.Available)) {
    profile.Gps=new GameGpsReader(profile.Map,()=>{var t=telemetry.Snapshot(profile.Id);return new(t.Connected,t.Data.PositionValid,new(t.Data.X,t.Data.Z));},profile.Id);
    _=profile.Gps.Run(app.Lifetime.ApplicationStopping);
    if(profile.Id=="ets2")profile.Rules=CoachRulesReader.Load(profile.Installation.Path,Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"Euro Truck Simulator 2","game.log.txt"));
}
TelemetrySnapshot DashboardSnapshot(string? requested=null) {
    var profile=catalog.For(requested);var t=telemetry.Snapshot(profile.Id);
    var coach=t.Connected&&t.Data.PositionValid&&profile.Gps!=null?profile.Gps.CoachSnapshot():CoachGameState.Unavailable("waiting_vehicle","Čakam na vozilo.");
    if(coach.State=="ready"&&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-coach.SampledAt>2000)coach=CoachGameState.Unavailable("stale","Coach bralnik čaka na sveže podatke.",coach.Build);
    return t with {Data=t.Data with {Coach=coach,CoachRules=profile.Rules}};
}
app.UseResponseCompression();
app.Use(async (context, next) => {
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    try {await next();}catch(InvalidOperationException ex)when(ex.Message.StartsWith("Map data missing")){context.Response.StatusCode=503;await context.Response.WriteAsJsonAsync(new {error=ex.Message});}
});
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = new FileExtensionContentTypeProvider(), OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache" });
app.MapGet("/api/status", (HttpContext context) => {var profile=catalog.For(context.Request.Query["game"]);var game=profile.Installation;return new {
    version = "0.11.1", gameId=profile.Id,gameName=profile.Name,mapReady=profile.Available,games=catalog.Games.Select(g=>new {id=g.Id,name=g.Name,mapReady=g.Available,installed=g.Installation.Path!=null}),
    telemetry = DashboardSnapshot(profile.Id), gameGps = profile.Gps is {} gps?gps.Snapshot() with {Route=null}:null, cities = profile.Available?profile.Map.Cities.Count:0,
    roads = profile.Available?profile.Map.EdgeCount:0, mapDate = "2026-11-13", gamePath = game.Path,
    dlcs = game.Dlcs.Order().ToArray(), gameFound = game.Path != null,
    pluginInstalled = game.Path != null && File.Exists(Path.Combine(game.Path, "bin", "win_x64", "plugins", "furagps-telemetry.dll")),
    addresses = NetworkInterface.GetAllNetworkInterfaces()
      .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
      .SelectMany(n => n.GetIPProperties().UnicastAddresses)
      .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork&&LanDiscovery.IsLocal(a.Address))
      .Select(a => $"http://{a.Address}:{port}").ToArray()
};});
app.MapGet("/api/game-gps", (long? after, HttpContext context) => {
    context.Response.Headers.CacheControl="no-store";
    var snapshot=catalog.For(context.Request.Query["game"]).Gps?.Snapshot();return Results.Json(snapshot==null?new GameGpsSnapshot("map_missing","Map data missing. Run Download-Maps.ps1.",0,null,null,"game-memory",true,false,[],null):after==snapshot.Revision?snapshot with {Route=null}:snapshot);
});
app.MapGet("/api/game-gps/diagnostics", (HttpContext context) => Results.File(JsonSerializer.SerializeToUtf8Bytes(new {
    appVersion="0.11.1", gameId=catalog.For(context.Request.Query["game"]).Id,capturedUtc=DateTimeOffset.UtcNow, reader="read-only-process", supportedGame="GPS: ETS2/ATS 1.62.x experimental; Coach schedule: checked ETS2 1.62.3.3 build", telemetry=DashboardSnapshot(context.Request.Query["game"]),
    targetsScope="Only waypoints exposed by the active game GPS; not a Coach timetable or HaulMP job API.",
    snapshot=catalog.For(context.Request.Query["game"]).Gps?.Snapshot()
},new JsonSerializerOptions(JsonSerializerDefaults.Web){WriteIndented=true}),"application/json","FuraGPS-GPS-diagnostika.json"));
app.MapGet("/api/map/{gameId}/{file}", (string gameId,string file) => {
    if(gameId is not ("ets2" or "ats"))return Results.NotFound();
    if(file is not ("roads.pmtiles" or "details.pmtiles"))return Results.NotFound();
    var path=Path.Combine(catalog.For(gameId).DataPath,file);
    return File.Exists(path)?Results.File(path,"application/octet-stream",enableRangeProcessing:true):Results.NotFound();
});
app.MapGet("/api/telemetry", async (HttpContext context) => {
    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-cache, no-transform";
    context.Response.Headers["X-Accel-Buffering"] = "no";
    var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
    long lastSequence = -1, lastSent = 0,lastCoachSample=-1; string? lastCoachState=null; bool? lastConnected = null;
    try {
        while (!context.RequestAborted.IsCancellationRequested) {
            var snapshot = DashboardSnapshot(context.Request.Query["game"]);
            if (snapshot.Sequence != lastSequence || snapshot.Connected != lastConnected || snapshot.Data.Coach?.SampledAt!=lastCoachSample || snapshot.Data.Coach?.State!=lastCoachState || Environment.TickCount64-lastSent >= 1000) {
                await context.Response.WriteAsync("data: " + JsonSerializer.Serialize(snapshot,jsonOptions) + "\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
                lastSequence = snapshot.Sequence; lastConnected = snapshot.Connected; lastSent = Environment.TickCount64;lastCoachSample=snapshot.Data.Coach?.SampledAt??0;lastCoachState=snapshot.Data.Coach?.State;
            }
            await Task.Delay(50, context.RequestAborted);
        }
    } catch (OperationCanceledException) { }
});
app.MapGet("/api/cities", (HttpContext c) => catalog.For(c.Request.Query["game"]).Map.Cities);
app.MapGet("/api/tile/{x:int}/{z:int}", (int x, int z, HttpContext c) => {
    c.Response.Headers.CacheControl = "public,max-age=86400";
    return Results.Json(catalog.For(c.Request.Query["game"]).Map.Tile(x, z));
});
app.MapGet("/api/tile/{level:int}/{x:int}/{z:int}", (int level,int x,int z,HttpContext c) => {
    if(level<0||level>2)return Results.BadRequest();
    c.Response.Headers.CacheControl="public,max-age=86400";
    return Results.Json(catalog.For(c.Request.Query["game"]).Map.Tile(x,z,level));
});
app.MapPost("/api/route", async (RouteRequest request,HttpContext context) => {
    if (!double.IsFinite(request.X) || !double.IsFinite(request.Z) || !double.IsFinite(request.ToX) || !double.IsFinite(request.ToZ)
       || Math.Abs(request.X) > 500000 || Math.Abs(request.Z) > 500000 || Math.Abs(request.ToX) > 500000 || Math.Abs(request.ToZ) > 500000)
        return Results.BadRequest(new { error = "Neveljavne koordinate." });
    try {
        var profile=catalog.For(context.Request.Query["game"]);var route = await Task.Run(() => profile.Map.Route(request));
        return route is null ? Results.NotFound(new { error = "Do cilja ni povezane poti v nameščenih DLC-jih. Izberi bližnjo cesto ali drugo mesto." }) : Results.Ok(route);
    } catch (Exception ex) { Console.WriteLine("Pot: " + ex.Message); return Results.Problem("Izračun poti ni uspel."); }
});
app.MapGet("/FuraGPS.apk", () => {
    var apk = Path.Combine(AppContext.BaseDirectory, "FuraGPS.apk");
    return File.Exists(apk) ? Results.File(apk, "application/vnd.android.package-archive", "FuraGPS.apk") : Results.NotFound();
});
foreach(var profile in catalog.Games)Console.WriteLine($"  {profile.Id.ToUpperInvariant()}: {(profile.Available?$"{profile.Map.Cities.Count} cities":"Map missing - run Download-Maps.ps1")}");
Console.WriteLine($"\n  PC: http://localhost:{port}\n  Connect your phone/tablet to the same Wi-Fi.\n  Keep this window open while driving.\n");
if(bindAddress!="127.0.0.1")foreach(var address in NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==OperationalStatus.Up&&n.NetworkInterfaceType!=NetworkInterfaceType.Loopback).SelectMany(n=>n.GetIPProperties().UnicastAddresses).Where(a=>LanDiscovery.IsLocal(a.Address)))Console.WriteLine($"  Android / LAN: http://{address.Address}:{port}");
if (!args.Contains("--no-browser")) {
    app.Lifetime.ApplicationStarted.Register(() => {
        try { Process.Start(new ProcessStartInfo($"http://localhost:{port}") { UseShellExecute = true }); } catch { }
    });
}
try { await app.RunAsync(); }
catch (IOException) { Console.WriteLine($"Vrata {port} so zasedena. Preveri, ali Fura GPS že deluje v drugem oknu."); }

record RouteRequest(double X, double Z, double ToX, double ToZ, double? Heading = null, bool AvoidFerries = false);
record Telemetry(double X = 0, double Z = 0, double Heading = 0, double Speed = 0, double SpeedLimit = 0,
    double Fuel = 0, int Gear = 0, double NavigationDistance = 0, double NavigationTime = 0, bool Paused = true,
    bool PositionValid = false, string DestinationCity = "", string DestinationCompany = "", double Scale = 19,
    string? PluginVersion = null, double? Rpm = null, double? FuelRange = null, double? FuelConsumption = null,
    double? CruiseSpeed = null, bool? ParkingBrake = null, int? Retarder = null,
    double? AccelerationX = null, double? AccelerationZ = null, long? GameMinutes = null,
    int? MultiplayerOffset = null, bool? NavigationValid = null, BusTelemetry? Bus = null,
    double? AccelerationY = null, double? AccelerationPeakX = null, double? AccelerationPeakY = null, double? AccelerationPeakZ = null,
    double? AccelerationPeakG = null, CoachGameState? Coach = null, CoachRules? CoachRules = null,string Game="ets2");
record BusTelemetry(bool Active = false, string NextStopId = "", string NextStopName = "",
    long? PlannedArrival = null, long? ActualArrival = null, int? Stage = null, int? Stages = null,
    double? Satisfaction = null, JsonElement[]? Attributes = null, bool AttributesTruncated = false, string LastEvent = "");
record TelemetrySnapshot(bool Connected, double Age, long Sequence, Telemetry Data,long? SampleTime=null);
record ReceivedTelemetry(Telemetry Data, long Received, long Sequence);
class TelemetryReceiver(int port) {
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string,ReceivedTelemetry> samples=new();
    private string active="ets2";private long sequence;
    public TelemetrySnapshot Snapshot(string? game=null) {
        string id=game=="ats"?"ats":game=="ets2"?"ets2":Volatile.Read(ref active);
        var sample = samples.GetValueOrDefault(id)??new(new Telemetry(Game:id),0,0);
        double age = sample.Received == 0 ? 999999 : (Environment.TickCount64-sample.Received)/1000.0;
        return new(age < 3,age,sample.Sequence,sample.Data,sample.Received==0?null:sample.Received);
    }
    public async Task Run() {
        try {
            using var udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, port));
            while (true) {
                var msg = await udp.ReceiveAsync();
                if (msg.Buffer.Length > 8192) continue;
                try {
                    var t = JsonSerializer.Deserialize<Telemetry>(msg.Buffer, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    if (t != null && t.Game is "ets2" or "ats" && double.IsFinite(t.X) && double.IsFinite(t.Z) && double.IsFinite(t.Heading)) {
                        var now=Environment.TickCount64;var old=Snapshot();
                        samples[t.Game]=new ReceivedTelemetry(t,now,Interlocked.Increment(ref sequence));
                        if(t.PositionValid&&!t.Paused||!old.Connected)Volatile.Write(ref active,t.Game);
                    }
                } catch (JsonException) { }
            }
        } catch (Exception ex) { Console.WriteLine("Telemetrija: " + ex.Message); }
    }
}
