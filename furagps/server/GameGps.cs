using System.Diagnostics;

record GpsVehicleState(bool Connected,bool Valid,Point Position);
record GpsGeometry(Point[] Points,double Distance,int MatchedSegments,int TotalSegments);
record GameGpsRoute(Point[] Points,Instruction[] Instructions,double Distance,string Source,string Geometry,double GameDistance,double GameTime);
record GameGpsSnapshot(string State,string Message,long Revision,string? Fingerprint,string? GameVersion,string Source,bool Experimental,bool TargetsAvailable,GpsTarget[] Targets,GameGpsRoute? Route);

// A fresh route is accepted after two identical complete reads. Any failed read
// clears it immediately. A same-length reroute is detected by its full fingerprint.
sealed class GpsRouteTracker {
    string? pending;
    long revision;
    GameGpsSnapshot current=new("waiting_game","Čakam na ETS2 / HaulMP.",0,null,null,"game-memory",true,false,[],null);
    public GameGpsSnapshot Snapshot=>Volatile.Read(ref current);
    public void Unavailable(string state,string message,string? version=null) {
        pending=null;var old=Snapshot;
        if(old.Route!=null||old.State!=state||old.Message!=message)revision++;
        Volatile.Write(ref current,new(state,message,revision,null,version,"game-memory",true,false,[],null));
    }
    public void Accept(RawGpsRoute raw,Func<GpsNode[],GpsGeometry> build,string version) {
        if(raw.Nodes.Length<2){Unavailable("no_route","V GPS-u igre ni aktivne trase. Čakam na naslednjo etapo.",version);return;}
        var old=Snapshot;
        if(old.Route!=null&&old.Fingerprint==raw.Fingerprint)return;
        if(pending!=raw.Fingerprint){pending=raw.Fingerprint;Volatile.Write(ref current,new("updating","Preverjam novo GPS pot …",++revision,null,version,"game-memory",true,false,[],null));return;}
        var geometry=build(raw.Nodes);
        if(geometry.Points.Length<2)throw new GpsReadException("invalid_layout","GPS trasa je prekratka.");
        var route=new GameGpsRoute(geometry.Points,[],geometry.Distance,"game","matched-roads",raw.Nodes[0].Distance,raw.Nodes[0].Time);
        if(geometry.MatchedSegments<geometry.TotalSegments)route=route with {Geometry="approximate"};
        Volatile.Write(ref current,new("ready",route.Geometry=="approximate"?"Berem GPS igre; del izrisa med vozlišči je približen.":"Berem aktivno GPS pot iz igre.",++revision,raw.Fingerprint,version,"game-memory",true,raw.TargetsAvailable,raw.Targets,route));
    }
}

sealed class GameGpsReader(RoadMap map,Func<GpsVehicleState> vehicle,string gameId="ets2") {
    readonly GpsRouteTracker tracker=new();
    CoachGameState coach=CoachGameState.Unavailable("waiting_game","Čakam na Coach vožnjo v ETS2 / HaulMP.");
    public GameGpsSnapshot Snapshot()=>tracker.Snapshot;
    public CoachGameState CoachSnapshot()=>Volatile.Read(ref coach);
    void ClearCoach(string message,string? build=null)=>Volatile.Write(ref coach,CoachGameState.Unavailable("unavailable",message,build));
    public async Task Run(CancellationToken cancellation) {
        WindowsGpsMemory? memory=null;int failedPid=0;long retryAfter=0;
        try {
            while(!cancellation.IsCancellationRequested) {
                try {
                    if(!OperatingSystem.IsWindows()){tracker.Unavailable("unsupported_platform","GPS bralnik deluje v Windows x64.");ClearCoach("Neposredno branje Coach deluje v Windows x64.");}
                    else {
                        var processes=Process.GetProcessesByName(gameId=="ats"?"amtrucks":"eurotrucks2");
                        try {
                            if(processes.Length!=1){memory?.Dispose();memory=null;failedPid=0;tracker.Unavailable(processes.Length==0?"waiting_game":"multiple_games",processes.Length==0?"Čakam na ETS2 / HaulMP.":"Zaznanih je več procesov ETS2; pusti odprto eno igro.");ClearCoach("Čakam na eno naloženo igro ETS2 / HaulMP.");}
                            else {
                                var process=processes[0];
                                if(memory!=null&&memory.ProcessId!=process.Id){memory.Dispose();memory=null;}
                                if(memory==null&&(process.Id!=failedPid||Environment.TickCount64>=retryAfter)) {
                                    try {memory=new WindowsGpsMemory(process,gameId);failedPid=0;}
                                    catch {failedPid=process.Id;retryAfter=Environment.TickCount64+10000;throw;}
                                }
                                if(memory!=null) {
                                    var pose=vehicle();
                                    if(!pose.Connected||!pose.Valid){tracker.Unavailable("waiting_vehicle","Čakam na veljaven položaj vozila iz vtičnika Fura GPS.",memory.Version);ClearCoach("Čakam na veljavne podatke vtičnika.",memory.Version);}
                                    else {
                                        // Timetable remains independent of route geometry/waypoint decoding.
                                        try {
                                            if(gameId=="ats")ClearCoach("Coach urnik je na voljo samo v ETS2.",memory.Version);
                                            else if(!CoachMemoryDecoder.Compatible(memory,memory.ModuleBase,memory.ExeSha256))ClearCoach("Ta različica ali sprememba HaulMP kode še nima preverjenega Coach bralnika.",memory.Version);
                                            else Volatile.Write(ref coach,CoachMemoryDecoder.Read(memory,memory.ModuleBase,memory.Version));
                                        }catch(GpsReadException ex){ClearCoach(ex.Message,memory.Version);}
                                        try {
                                            var raw=GpsMemoryDecoder.Read(memory,memory.ModuleBase+memory.Signatures.GlobalRva,memory.Signatures.ManagerOffset);
                                            if(raw.Nodes.Length>1&&!NearRoute(raw.Nodes,pose.Position))throw new GpsReadException("position_mismatch","GPS pot se ne ujema s položajem vozila; podatki niso uporabljeni.");
                                            tracker.Accept(raw,map.TraceGameRoute,memory.Version);
                                        }catch(GpsReadException ex){tracker.Unavailable(ex.Code,ex.Message,memory.Version);}
                                    }
                                }
                            }
                        } finally {foreach(var process in processes)process.Dispose();}
                    }
                } catch(GpsReadException ex) {tracker.Unavailable(ex.Code,ex.Message,memory?.Version);ClearCoach(ex.Message,memory?.Version);if(ex.Code=="read_failed"){memory?.Dispose();memory=null;}}
                catch(Exception ex) when(ex is System.ComponentModel.Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException or OverflowException or ArgumentException) {tracker.Unavailable("read_failed","GPS podatki niso dosegljivi. Čakam na ponovni priklop.",memory?.Version);ClearCoach("Coach podatki trenutno niso dosegljivi.",memory?.Version);memory?.Dispose();memory=null;}
                await Task.Delay(250,cancellation);
            }
        } catch(OperationCanceledException)when(cancellation.IsCancellationRequested){}
        finally {memory?.Dispose();}
    }
    public static bool NearRoute(GpsNode[] nodes,Point p) {
        for(int i=1;i<nodes.Length;i++) {
            var a=nodes[i-1];var b=nodes[i];double dx=b.X-a.X,dz=b.Z-a.Z,t=Math.Clamp(((p.X-a.X)*dx+(p.Z-a.Z)*dz)/(dx*dx+dz*dz+1e-9),0,1);
            double ex=p.X-a.X-t*dx,ez=p.Z-a.Z-t*dz;if(ex*ex+ez*ez<2000*2000)return true;
        }
        return false;
    }
}
