using System.Buffers.Binary;
using System.Text;

static void Check(bool value,string message) {if(!value)throw new Exception(message);Console.WriteLine("PASS: "+message);}
static void Reject(Action action,string code) {try{action();throw new Exception("Expected rejection: "+code);}catch(GpsReadException ex){Check(ex.Code==code,"reject "+code);}}
var memory=new FixtureMemory();
const long global=0x11000,controller=0x20000,table=0x30000,getter=0x40000,descriptor=0x41000,slot=0x42000,name=0x43000,task=0x50000,items=0x60000,targets=0x61000;
const int offset=0x4128;long manager=controller+offset;
memory.I64(global,controller);memory.I64(controller,table);memory.I64(table+40,getter);
var code=new byte[16];code[0]=0x48;code[1]=0x8d;code[2]=5;BinaryPrimitives.WriteInt32LittleEndian(code.AsSpan(3),(int)(descriptor-getter-7));code[7]=0xc3;memory.Put(getter,code);
memory.I64(descriptor,slot);memory.I64(slot,name);memory.Put(name,new byte[32]);memory.Put(name,Encoding.ASCII.GetBytes("game_ctrl"));
memory.I64(manager+0x28,task);memory.Vector(task+0x50,items,3);memory.Put(items,new byte[3*32]);
long[] pointers=[0x70000,0x70100,0x70200];ulong[] uids=[0xfedcba9876543210,0xfedcba9876543211,0xfedcba9876543212];
for(int i=0;i<3;i++){memory.Node(pointers[i],uids[i],100+i*100,200);memory.I64(items+i*32,pointers[i]);memory.Float(items+i*32+0x14,4000-i*2000);memory.Float(items+i*32+0x18,200-i*100);}
memory.Vector(manager+0x1f8,targets,2);memory.Put(targets,new byte[2*24]);memory.I64(targets+8,pointers[1]);memory.I64(targets+24+8,pointers[2]);
RawGpsRoute Read()=>GpsMemoryDecoder.Read(memory,global,offset);
var first=Read();Check(first.Nodes.Length==3&&first.Targets.Length==2&&first.TargetsAvailable,"read complete route and multiple GPS targets");
Check(first.Nodes[0].X==100&&first.Nodes[0].Z==200&&first.Targets[0].Id=="fedcba9876543211","fixed-point coordinates and 64-bit UID are preserved");
var tracker=new GpsRouteTracker();int builds=0;
GpsGeometry Build(GpsNode[] nodes){builds++;return new(nodes.Select(n=>new Point(n.X,n.Z)).ToArray(),200,0,2);}
tracker.Accept(first,Build,"1.62.3.3");Check(tracker.Snapshot.Route==null&&tracker.Snapshot.State=="updating","require two consistent snapshots before displaying route");
tracker.Accept(first,Build,"1.62.3.3");Check(tracker.Snapshot.Route?.Source=="game"&&tracker.Snapshot.Targets.Length==2,"publish game route with both targets");
long revision=tracker.Snapshot.Revision;tracker.Accept(Read(),Build,"1.62.3.3");Check(builds==1&&tracker.Snapshot.Revision==revision,"unchanged route does not rebuild geometry");
memory.Node(pointers[1],uids[1]+50,200,260);var reroute=Read();Check(reroute.Nodes.Length==first.Nodes.Length&&reroute.Fingerprint!=first.Fingerprint,"same-count reroute with changed middle node is detected");
tracker.Accept(reroute,Build,"1.62.3.3");Check(tracker.Snapshot.Route==null,"clear old route while confirming reroute");tracker.Accept(reroute,Build,"1.62.3.3");Check(tracker.Snapshot.Route!.Points[1].Z==260,"replace route after game replanning");
memory.Vector(manager+0x1f8,targets,1);memory.I64(targets+8,pointers[2]);var secondLeg=Read();Check(secondLeg.Fingerprint!=reroute.Fingerprint&&secondLeg.Targets.Length==1,"target progression is detected even with unchanged route count");
tracker.Accept(secondLeg,Build,"1.62.3.3");tracker.Accept(secondLeg,Build,"1.62.3.3");Check(tracker.Snapshot.Targets.Length==1&&tracker.Snapshot.Targets[0].Id=="fedcba9876543212","remaining game target replaces previous list");
memory.I64(manager+0x28,0);tracker.Accept(Read(),Build,"1.62.3.3");Check(tracker.Snapshot.Route==null&&tracker.Snapshot.State=="no_route","clear finished leg and wait for next game route");
memory.I64(manager+0x28,task);tracker.Accept(Read(),Build,"1.62.3.3");tracker.Accept(Read(),Build,"1.62.3.3");tracker.Unavailable("waiting_game","Game closed");Check(tracker.Snapshot.Route==null&&tracker.Snapshot.Targets.Length==0,"game disconnect clears stale route and stop list");
tracker.Accept(Read(),Build,"1.62.3.3");Check(tracker.Snapshot.Route==null,"reconnect requires fresh confirmation");
memory.Vector(task+0x50,items,20001);Reject(()=>Read(),"invalid_layout");memory.Vector(task+0x50,items,3);
memory.Float(items+0x14,float.NaN);Reject(()=>Read(),"invalid_layout");memory.Float(items+0x14,4000);
memory.Node(pointers[0],uids[0],400000,200);Reject(()=>Read(),"invalid_layout");memory.Node(pointers[0],uids[0],100,200);
memory.Vector(manager+0x1f8,targets,200);var withoutTargets=Read();Check(!withoutTargets.TargetsAvailable&&withoutTargets.Targets.Length==0&&withoutTargets.Fingerprint!=secondLeg.Fingerprint,"unavailable waypoint layout never leaves stale targets");memory.Vector(manager+0x1f8,targets,1);
memory.ChangesOnSecondItemsRead=true;Reject(()=>Read(),"updating");memory.ChangesOnSecondItemsRead=false;
memory.Put(name,new byte[32]);memory.Put(name,Encoding.ASCII.GetBytes("menu_ctrl"));Reject(()=>Read(),"waiting_vehicle");
Check(GameGpsReader.NearRoute(first.Nodes,new(150,210))&&!GameGpsReader.NearRoute(first.Nodes,new(10000,10000)),"reject GPS route inconsistent with live vehicle position");
if(args.Length>0){var signatures=GpsSignatureLocator.Locate(args[0]);Check(signatures.ManagerOffset>=0x1000&&signatures.GlobalRva>0,"selected game executable has agreeing GPS signatures");Console.WriteLine($"GPS offset 0x{signatures.ManagerOffset:x}; global RVA 0x{signatures.GlobalRva:x}");}
if(args.Length>1){
    var map=new RoadMap(args[1],Enumerable.Range(1,11).ToHashSet());var trace=map.TraceGameRoute([new(1,200000,200000,100,10),new(2,200100,200000,50,5),new(3,200000,200000,0,0)]);
    Check(trace.MatchedSegments==0&&trace.Points.Length==3&&trace.Points[0]==trace.Points[^1],"unmatched loop follows supplied GPS node order without inventing a shortcut");
    var graph=System.Runtime.InteropServices.MemoryMarshal.Cast<byte,float>(File.ReadAllBytes(Path.Combine(args[1],"graph.bin"))).ToArray();
    var geometry=System.Runtime.InteropServices.MemoryMarshal.Cast<byte,float>(File.ReadAllBytes(Path.Combine(args[1],"geometry.bin"))).ToArray();
    Point At(int i){double lat=geometry[i*2+1]*Math.PI/180;return new(geometry[i*2]*Math.PI/180*300000,-300000*Math.Log(Math.Tan((lat+Math.PI/2)/2)));}
    bool curved=false;
    for(int e=0;e<Math.Min(10000,graph.Length/12)&&!curved;e++){
        int ptr=(int)graph[e*12+8]/2,count=(int)graph[e*12+9];if(count<4||graph[e*12+5]==1)continue;
        var a=At(ptr);var b=At(ptr+count-1);double chord=Math.Sqrt((b.X-a.X)*(b.X-a.X)+(b.Z-a.Z)*(b.Z-a.Z));
        var matched=map.TraceGameRoute([new(1,a.X,a.Z,100,10),new(2,b.X,b.Z,0,0)]);
        curved=matched.MatchedSegments==1&&matched.Points.Length>2&&matched.Distance>chord+.5;
    }
    Check(curved,"actual map road curves are recovered between consecutive game nodes");
}
CoachChecks.Run(args.Length>0&&Path.GetFileName(args[0]).Equals("amtrucks.exe",StringComparison.OrdinalIgnoreCase)?[]:args);
Console.WriteLine("GPS and Coach reader checks passed. These fixtures do not replace a Coach/HaulMP drive.");

record RouteRequest(double X,double Z,double ToX,double ToZ,double? Heading=null,bool AvoidFerries=false);
sealed class FixtureMemory : IGpsMemory {
    readonly Dictionary<long,byte> bytes=[];public bool ChangesOnSecondItemsRead;int itemsReads;
    public void Put(long at,byte[] value){for(int i=0;i<value.Length;i++)bytes[at+i]=value[i];}
    public void I64(long at,long value){var b=new byte[8];BinaryPrimitives.WriteInt64LittleEndian(b,value);Put(at,b);}
    public void Float(long at,float value){var b=new byte[4];BinaryPrimitives.WriteSingleLittleEndian(b,value);Put(at,b);}
    public void Vector(long at,long data,int count){Put(at,new byte[32]);I64(at+8,data);I64(at+16,count);I64(at+24,count);}
    public void Node(long at,ulong uid,double x,double z){var b=new byte[0x38];BinaryPrimitives.WriteInt32LittleEndian(b,(int)(x*256));BinaryPrimitives.WriteInt32LittleEndian(b.AsSpan(8),(int)(z*256));BinaryPrimitives.WriteUInt64LittleEndian(b.AsSpan(0x30),uid);Put(at,b);}
    public byte[] Read(long at,int length){var result=new byte[length];for(int i=0;i<length;i++)if(!bytes.TryGetValue(at+i,out result[i]))throw new GpsReadException("read_failed","Fixture missing bytes");if(at==0x60000&&ChangesOnSecondItemsRead&&++itemsReads%2==0)result[0]^=1;return result;}
}
