using System.Runtime.InteropServices;
using System.Text.Json;

record City(string Token, string Name, string CountryToken, double X, double Y);
record Point(double X, double Z);
record Instruction(int Index, string Kind, string Text, double Distance);
record RouteResult(Point[] Points, Instruction[] Instructions, double Distance, double SnapDistance, double EndSnapDistance, int Edges, int[] UsedDlcs);
partial class RoadMap {
    const int Stride = 12;
    const double Cell = 4096;
    readonly float[] graph;
    readonly Point[] geometry;
    readonly Dictionary<int, Point> nodes = new();
    readonly Dictionary<int, List<int>> outgoing = new();
    readonly Dictionary<(int,int), List<int>> tileIndex = new();
    readonly HashSet<int> dlcs;
    readonly bool[] allowed;
    public List<City> Cities { get; }
    public int EdgeCount => graph.Length / Stride;
    public RoadMap(string dataPath, HashSet<int> ownedDlcs) {
        dlcs = ownedDlcs;
        graph = MemoryMarshal.Cast<byte, float>(File.ReadAllBytes(Path.Combine(dataPath, "graph.bin"))).ToArray();
        var raw = MemoryMarshal.Cast<byte, float>(File.ReadAllBytes(Path.Combine(dataPath, "geometry.bin"))).ToArray();
        if (graph.Length % Stride != 0 || raw.Length % 2 != 0) throw new InvalidDataException("Neveljaven format zemljevida.");
        geometry = new Point[raw.Length / 2];
        for (int p = 0; p < geometry.Length; p++) {
            var lat = raw[2 * p + 1] * Math.PI / 180;
            geometry[p] = new(raw[p * 2] * Math.PI / 180 * 300000, -300000 * Math.Log(Math.Tan((lat + Math.PI / 2) / 2)));
        }
        allowed = new bool[EdgeCount];
        for (int e = 0; e < EdgeCount; e++) {
            int i = e * Stride, u = (int)graph[i], v = (int)graph[i+1], count = Count(e), ptr = Pointer(e);
            if (ptr < 0 || count < 2 || ptr + count > geometry.Length) throw new InvalidDataException("Neveljavna cestna geometrija.");
            nodes.TryAdd(u, geometry[ptr]); nodes.TryAdd(v, geometry[ptr+count-1]);
            allowed[e] = graph[i+6] == 0 || dlcs.Contains((int)graph[i+6]);
            if (!allowed[e]) continue;
            if (!outgoing.TryGetValue(u, out var list)) outgoing[u] = list = new();
            list.Add(e);
            double minX=double.MaxValue,minZ=double.MaxValue,maxX=double.MinValue,maxZ=double.MinValue;
            foreach(var p in geometry.AsSpan(ptr,count)) { minX=Math.Min(minX,p.X); minZ=Math.Min(minZ,p.Z); maxX=Math.Max(maxX,p.X); maxZ=Math.Max(maxZ,p.Z); }
            int x0=(int)Math.Floor(minX/Cell),x1=(int)Math.Floor(maxX/Cell),z0=(int)Math.Floor(minZ/Cell),z1=(int)Math.Floor(maxZ/Cell);
            if ((x1-x0+1)*(z1-z0+1) > 400) continue;
            for(int x=x0;x<=x1;x++) for(int z=z0;z<=z1;z++) {
                if(!tileIndex.TryGetValue((x,z),out var tile)) tileIndex[(x,z)] = tile = new();
                tile.Add(e);
            }
        }
        // Some junction/prefab edges have DLC id 0 inside DLC territory.
        // Keep the connected main road network; orphan fragments are not drivable.
        var parents=nodes.Keys.ToDictionary(id=>id,id=>id);
        int Root(int id) { int root=id;while(parents[root]!=root)root=parents[root];while(parents[id]!=id){int next=parents[id];parents[id]=root;id=next;}return root; }
        for(int e=0;e<EdgeCount;e++)if(allowed[e]){int a=Root(U(e)),b=Root(V(e));if(a!=b)parents[a]=b;}
        var counts=new Dictionary<int,int>();foreach(int id in nodes.Keys){int r=Root(id);counts[r]=counts.GetValueOrDefault(r)+1;}
        int mainRoot=counts.MaxBy(pair=>pair.Value).Key;
        for(int e=0;e<EdgeCount;e++)if(allowed[e]&&Root(U(e))!=mainRoot)allowed[e]=false;
        foreach(var list in outgoing.Values)list.RemoveAll(e=>!allowed[e]);
        foreach(var list in tileIndex.Values)list.RemoveAll(e=>!allowed[e]);
        Cities = JsonSerializer.Deserialize<List<City>>(File.ReadAllText(Path.Combine(dataPath,"cities.json")), new JsonSerializerOptions { PropertyNameCaseInsensitive=true }) ?? new();
        // A city is offered only when an accessible road exists nearby.
        Cities = Cities.Where(c => Nearby(new(c.X,c.Y), 1800).Count > 0).ToList();
    }
    int Pointer(int e) => (int)graph[e*Stride+8]/2;
    int Count(int e) => (int)graph[e*Stride+9];
    int U(int e) => (int)graph[e*Stride];
    int V(int e) => (int)graph[e*Stride+1];
    bool Ferry(int e) => graph[e*Stride+5] == 1;
    static double Dist(Point a,Point b) => Math.Sqrt((a.X-b.X)*(a.X-b.X)+(a.Z-b.Z)*(a.Z-b.Z));
    static double Angle(double a,double b) => Math.Abs(Math.IEEERemainder(a-b,Math.PI*2));
    double Bearing(int e) { int p=Pointer(e); var a=geometry[p]; var b=geometry[p+Math.Min(2,Count(e)-1)]; return Math.Atan2(b.X-a.X, -(b.Z-a.Z)); }
    public object Tile(int x,int z,int level=0) {
        level=Math.Clamp(level,0,2);int factor=1<<level;
        var es=new HashSet<int>();
        for(int a=0;a<factor;a++)for(int b=0;b<factor;b++)if(tileIndex.TryGetValue((x*factor+a,z*factor+b),out var list))foreach(int e in list)es.Add(e);
        var seen=new HashSet<(int,int)>(); var roads=new List<object>();
        foreach(int e in es) {
            var key=(Math.Min(U(e),V(e)),Math.Max(U(e),V(e)));
            if(!seen.Add(key)) continue;
            if(level>0 && !Ferry(e) && graph[e*Stride+2] < (level==1?25:60))continue;
            var coords=new List<double>(); int ptr=Pointer(e),n=Count(e);
            int step=level==0?1:level==1?3:8;
            for(int j=0;j<n-1;j+=step) { var p=geometry[ptr+j]; coords.Add(Math.Round(p.X,1));coords.Add(Math.Round(p.Z,1)); }
            var last=geometry[ptr+n-1];coords.Add(Math.Round(last.X,1));coords.Add(Math.Round(last.Z,1));
            roads.Add(new { ferry=Ferry(e), points=coords });
        }
        return new { roads };
    }
    List<int> Nearby(Point p,double radius) {
        var result=new HashSet<int>(); int x0=(int)Math.Floor((p.X-radius)/Cell),x1=(int)Math.Floor((p.X+radius)/Cell),z0=(int)Math.Floor((p.Z-radius)/Cell),z1=(int)Math.Floor((p.Z+radius)/Cell);
        for(int x=x0;x<=x1;x++) for(int z=z0;z<=z1;z++) if(tileIndex.TryGetValue((x,z),out var es)) foreach(int e in es) result.Add(e);
        return result.Where(e=> Dist(nodes[U(e)],p)<radius || Dist(nodes[V(e)],p)<radius).ToList();
    }
    public RouteResult? Route(RouteRequest request) {
        var start=new Point(request.X,request.Z); var end=new Point(request.ToX,request.ToZ);
        var starts=Nearby(start,1200).Select(U).Distinct().Where(outgoing.ContainsKey).OrderBy(n=>Dist(nodes[n],start)).Take(8).ToArray();
        var ends=Nearby(end,1800).SelectMany(e=>new[]{U(e),V(e)}).Distinct().OrderBy(n=>Dist(nodes[n],end)).Take(8).ToDictionary(n=>n,n=>Dist(nodes[n],end));
        if(starts.Length==0 || ends.Count==0) return null;
        // Each arrival edge is a state, so junction turn costs depend on the approach.
        int n=EdgeCount; var costs=new double[n]; Array.Fill(costs,double.PositiveInfinity);
        var previous=new int[n]; Array.Fill(previous,-1);
        var queue=new PriorityQueue<int,double>();
        double? heading=request.Heading.HasValue ? request.Heading.Value*Math.PI/180 : null;
        foreach(int s in starts) foreach(int e in outgoing[s]) {
            if(request.AvoidFerries && Ferry(e)) continue;
            double delta=heading.HasValue?Angle(Bearing(e),heading.Value):0;
            var cost=Dist(nodes[s],start)*40+Math.Max(1,graph[e*Stride+2])+(delta>2.2?100000:delta*100);
            if(cost<costs[e]) {costs[e]=cost;queue.Enqueue(e,cost);}
        }
        int finish=-1; double best=double.PositiveInfinity; int visited=0;
        while(queue.TryDequeue(out int e,out double cost)) {
            if(cost!=costs[e]) continue;
            if(cost>best) break;
            if(++visited>n*4) break;
            int v=V(e);
            if(ends.TryGetValue(v,out double endDist) && cost+endDist*40<best) { best=cost+endDist*40; finish=e; }
            if(!outgoing.TryGetValue(v,out var next)) continue;
            foreach(int f in next) {
                if(request.AvoidFerries && Ferry(f)) continue;
                double turn=Angle(graph[e*Stride+3],graph[f*Stride+4]);
                double penalty=V(f)==U(e)?100000:turn>2.8?100000:turn>1.5?1500:turn>0.7?60:0;
                double c=cost+Math.Max(1,graph[f*Stride+2])+penalty;
                if(c<costs[f]) {costs[f]=c;previous[f]=e;queue.Enqueue(f,c);}
            }
        }
        if(finish<0) return null;
        var edges=new List<int>(); for(int e=finish;e!=-1;e=previous[e]) { edges.Add(e); if(edges.Count>n) throw new InvalidDataException("Zanka v poti."); } edges.Reverse();
        var points=new List<Point>(); var instructions=new List<Instruction>(); double distance=0;
        int? prev=null;
        foreach(int e in edges) {
            if(Ferry(e)) instructions.Add(new(points.Count,"ferry","Nadaljuj s trajektom",distance));
            else if(prev.HasValue) {
                double a=graph[prev.Value*Stride+3], b=graph[e*Stride+4];
                double signed=Math.IEEERemainder(a-b,Math.PI*2); // east-counterclockwise headings -> right-positive
                int maneuver=(int)graph[e*Stride+10],exit=(int)graph[e*Stride+11];
                if(maneuver==3 && exit>0) instructions.Add(new(points.Count,"roundabout",$"V krožišču izberi {exit}. izvoz",distance));
                else if(Math.Abs(signed)>0.55) instructions.Add(new(points.Count,signed>0?"right":"left",signed>0?"Zavij desno":"Zavij levo",distance));
            }
            int ptr=Pointer(e),count=Count(e);
            for(int j=0;j<count;j++) { var p=geometry[ptr+j]; if(points.Count>0 && Dist(points[^1],p)<0.1) continue; if(points.Count>0) distance+=Dist(points[^1],p); points.Add(p); }
            prev=e;
        }
        instructions.Add(new(Math.Max(0,points.Count-1),"arrive","Cilj je ob najbližji cesti",distance));
        return new(points.ToArray(),instructions.ToArray(),distance,Dist(start,points[0]),Dist(end,points[^1]),edges.Count,edges.Select(e=>(int)graph[e*Stride+6]).Where(d=>d>0).Distinct().Order().ToArray());
    }
}
