partial class RoadMap {
    Dictionary<(int,int),List<int>>? gpsStarts;
    public GpsGeometry TraceGameRoute(GpsNode[] gps) {
        // Match only consecutive nodes already selected by the game. Never run a
        // shortest-path search between the vehicle and the final destination.
        if(gpsStarts==null) {
            var index=new Dictionary<(int,int),List<int>>();
            for(int e=0;e<EdgeCount;e++)if(allowed[e]) {
                var p=geometry[Pointer(e)];var key=((int)Math.Floor(p.X/32),(int)Math.Floor(p.Z/32));
                if(!index.TryGetValue(key,out var list))index[key]=list=[];list.Add(e);
            }
            gpsStarts=index;
        }
        var points=new List<Point>();int matched=0,total=0;double length=0;
        void Add(Point p) {if(points.Count>0){double d=Dist(points[^1],p);if(d<.05)return;length+=d;}points.Add(p);}
        for(int i=1;i<gps.Length;i++) {
            Point a=new(gps[i-1].X,gps[i-1].Z),b=new(gps[i].X,gps[i].Z);
            if(Dist(a,b)<.05)continue;total++;
            int x=(int)Math.Floor(a.X/32),z=(int)Math.Floor(a.Z/32),best=-1;double error=32;
            for(int ix=x-1;ix<=x+1;ix++)for(int iz=z-1;iz<=z+1;iz++)if(gpsStarts.TryGetValue((ix,iz),out var edges))foreach(int e in edges) {
                int ptr=Pointer(e),count=Count(e);double start=Dist(geometry[ptr],a),end=Dist(geometry[ptr+count-1],b);
                if(start<16&&end<16&&start+end<error){error=start+end;best=e;}
            }
            if(best>=0) {matched++;int ptr=Pointer(best);for(int j=0;j<Count(best);j++)Add(geometry[ptr+j]);}
            else {Add(a);Add(b);} // Explicitly reported as an approximate segment.
        }
        if(points.Count==0&&gps.Length>0)Add(new(gps[0].X,gps[0].Z));
        return new(points.ToArray(),length,matched,total);
    }
}
