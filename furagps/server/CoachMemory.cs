using System.Buffers.Binary;
using System.Security.Cryptography;

record CoachGameState(string State,string Message,string? Build=null,string? Scope=null,int? Stage=null,int? Stages=null,
    long? Now=null,long? Planned=null,float? NavigationSeconds=null,int? DelayMinutes=null,bool? Gradual=null,int? ScheduleAdjustment=null,long SampledAt=0) {
    public static CoachGameState Unavailable(string state,string message,string? build=null)=>new(state,message,build);
}

// Read-only adapter for the installed 1.62.3.3 build. This reproduces its
// current-stage delay helper; it never calls a function in the game process.
// Offsets are enabled only for the exact executable AND unchanged loaded code.
static class CoachMemoryDecoder {
    public const string SupportedSha256="055EC5343D53BD427DE54B06ECA74937F0D348DBB0C5D71862EDDDCF45E2DB66";
    static readonly (int Rva,int Length,string Hash)[] Guards=[
        (0x5a8cc0,0x1cf,"2a4efc5272acbd07e70a1e49ad27561ca1c33f60e2a93082e1fded80158f55bd"),
        (0x5a7520,0x60,"b5c6077eb154e4af83dc994e5c32a05892102925cf7a0325057d57b4413a5a07"),
        (0x5a74e0,0x33,"217ccde992c4b7d33de8ee8c240a824df5e49399bb886327735749b8b34693cb"),
        (0x925610,0x63,"70952572aa2550513a78956e2e9eeb0ba89937baca5da0f72bbb6a3667394897"),
        (0x796320,0x40,"735e9fde3b213c2026a301ee28c741a2369acfead3669c0dafbe9edddcc75988"),
        (0x1d3180,0x40,"ab642c2a5271251f9233f2a3bb57be5782b8b75da5309b268dd74131fb0d24b3"),
        (0x110ff40,0x90,"6a8e79d4eb693bfe89b070cfdc73c108000064f3b4dc991f36cd11a05fa8c619")];
    public static bool Compatible(IGpsMemory m,long module,string hash)=>
        hash.Equals(SupportedSha256,StringComparison.OrdinalIgnoreCase)&&Guards.All(g=>
            Convert.ToHexString(SHA256.HashData(m.Read(module+g.Rva,g.Length))).Equals(g.Hash,StringComparison.OrdinalIgnoreCase));
    static long Ptr(IGpsMemory m,long at)=>BinaryPrimitives.ReadInt64LittleEndian(m.Read(at,8));
    static uint U32(byte[] b,int offset)=>BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(offset));
    static void Require(bool valid){if(!valid)throw new GpsReadException("coach_layout","Coach podatki niso dovolj zanesljivi; uporabljena je samo označena ocena.");}
    static int ConfigInt(IGpsMemory m,long at) {
        var visited=new HashSet<long>();
        for(int i=0;i<8;i++) {
            Require(GpsMemoryDecoder.Pointer(at)&&visited.Add(at));var b=m.Read(at+0x110,0x18);
            long alias=BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan(0x10));
            if(alias!=0){at=alias;continue;}
            // Only consume the game's cached typed value, never guess/parse an unset cache.
            Require(b[6]==1);return BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(8));
        }
        throw new GpsReadException("coach_layout","Nastavitev voznega reda še ni dosegljiva.");
    }
    public static int GameRound(float value)=>checked((int)MathF.Floor(value+0.5f));
    public static int Adjustment(bool gradual,uint total,uint progress,uint budget,uint baseline) {
        if(!gradual||total==0)return 0;
        float ratio=Math.Clamp((float)progress/(float)total,0f,1f);
        return GameRound((1f-ratio)*(float)unchecked((int)(budget-baseline)));
    }
    static bool MultiplayerTimetable(IGpsMemory m,long module) {
        long session=Ptr(m,module+0x3715040);if(session==0)return false;Require(GpsMemoryDecoder.Pointer(session));
        var state=m.Read(session,0x18);if(state[0xb] is not (8 or 9))return false;
        long sub=BinaryPrimitives.ReadInt64LittleEndian(state.AsSpan(0x10));if(sub==0)return false;Require(GpsMemoryDecoder.Pointer(sub));return m.Read(sub+0xc8,1)[0]==5;
    }
    // The game stores UINT_MAX for derived arrivals/departures. Resolve exactly
    // as its helpers do, including previous-stage layover and MP time adjustment.
    public static uint PlannedArrival(IGpsMemory m,long module,long economy,long stage,Dictionary<long,byte[]> captured) {
        bool multiplayer=MultiplayerTimetable(m,module);var resolving=new HashSet<long>();
        byte[] Stage(long at) {
            if(captured.TryGetValue(at,out var found))return found;
            Require(captured.Count<256&&GpsMemoryDecoder.Pointer(at)&&GpsMemoryDecoder.ControllerType(m,at)=="player_bus_job_stage");return captured[at]=m.Read(at,0x64);
        }
        uint Layover(long at) {
            if(multiplayer)return 0;
            var s=Stage(at);long owner=BinaryPrimitives.ReadInt64LittleEndian(s.AsSpan(0x20));Require(GpsMemoryDecoder.Pointer(owner));
            long handle=Ptr(m,owner+0x58);Require(handle==0||GpsMemoryDecoder.Pointer(handle));uint minutes;
            if(handle!=0&&GpsMemoryDecoder.Pointer(handle)&&(BinaryPrimitives.ReadUInt32LittleEndian(m.Read(handle+8,4))&0x80000000)!=0)minutes=BinaryPrimitives.ReadUInt32LittleEndian(m.Read(handle+0x14,4));
            else {long config=Ptr(m,economy+0x1d58);Require(GpsMemoryDecoder.Pointer(config));minutes=BinaryPrimitives.ReadUInt32LittleEndian(m.Read(config+0xc4,4));}
            Require(minutes<=10080);return minutes;
        }
        uint Arrival(long at) {
            Require(resolving.Add(at));var s=Stage(at);uint arrival=U32(s,0x30);
            if(arrival==uint.MaxValue) {
                uint departure=U32(s,0x2c);
                if(departure==uint.MaxValue){long previous=BinaryPrimitives.ReadInt64LittleEndian(s.AsSpan(0x10));Require(previous!=at&&GpsMemoryDecoder.Pointer(previous));departure=unchecked(Arrival(previous)+Layover(previous));}
                arrival=unchecked(departure+U32(s,0x34)-(multiplayer?U32(s,0x38):0));
            }
            resolving.Remove(at);return arrival;
        }
        uint result=Arrival(stage);Require(MultiplayerTimetable(m,module)==multiplayer&&result!=uint.MaxValue);return result;
    }
    public static CoachGameState Read(IGpsMemory m,long module,string build) {
        long controller=Ptr(m,module+0x3714fb0),economy=Ptr(m,module+0x30aa900);
        Require(GpsMemoryDecoder.Pointer(controller)&&GpsMemoryDecoder.ControllerType(m,controller)=="game_ctrl");
        Require(GpsMemoryDecoder.Pointer(economy));long profile=Ptr(m,economy+0x18);Require(GpsMemoryDecoder.Pointer(profile));
        long job=Ptr(m,profile+0x30);
        if(job==0)return CoachGameState.Unavailable("no_bus_job","V igri ni aktivne Coach vožnje.",build);
        Require(GpsMemoryDecoder.Pointer(job)&&GpsMemoryDecoder.ControllerType(m,job)=="player_bus_job");
        var j=m.Read(job,0x168);long data=BinaryPrimitives.ReadInt64LittleEndian(j.AsSpan(0x38));
        ulong count=BinaryPrimitives.ReadUInt64LittleEndian(j.AsSpan(0x40)),capacity=BinaryPrimitives.ReadUInt64LittleEndian(j.AsSpan(0x48));
        uint index=U32(j,0x58);Require(count is >0 and <=256&&index<count&&capacity>=count&&capacity<=4096&&GpsMemoryDecoder.Pointer(data));
        long stage=Ptr(m,data+index*8);Require(GpsMemoryDecoder.Pointer(stage)&&GpsMemoryDecoder.ControllerType(m,stage)=="player_bus_job_stage");
        var s=m.Read(stage,0x64);var captured=new Dictionary<long,byte[]>{{stage,s}};
        uint planned=PlannedArrival(m,module,economy,stage,captured);
        float seconds=BinaryPrimitives.ReadSingleLittleEndian(m.Read(controller+0x43b8,4));
        if(!float.IsFinite(seconds)||seconds<0||seconds>30*86400)return CoachGameState.Unavailable("no_eta","Igra še nima časa do naslednjega postanka.",build);
        uint now=BinaryPrimitives.ReadUInt32LittleEndian(m.Read(economy+0x19c,4));
        bool gradual=ConfigInt(m,module+0x2da5d60)!=0;
        int extra=Adjustment(gradual,U32(s,0x28),U32(s,0x50),U32(s,0x34),U32(s,0x60));
        uint effectiveNow=j[0x158]!=0&&!(index+1==count&&U32(s,0x54)!=uint.MaxValue)?Math.Max(now,U32(j,0x164)):now;
        long delta=(long)effectiveNow+GameRound(seconds*0.01666666753590107f)-planned+extra;
        Require(Math.Abs(delta)<=43200&&Math.Abs(extra)<=43200&&Math.Abs((long)now-planned)<=43200);
        // Reject a stop switch, save load or timetable edit during this snapshot.
        var j2=m.Read(job,0x168);var s2=m.Read(stage,0x64);
        Require(Ptr(m,module+0x3714fb0)==controller&&Ptr(m,module+0x30aa900)==economy&&Ptr(m,economy+0x18)==profile&&Ptr(m,profile+0x30)==job&&
            j.AsSpan(0x30,0x2c).SequenceEqual(j2.AsSpan(0x30,0x2c))&&j.AsSpan(0x158,0x10).SequenceEqual(j2.AsSpan(0x158,0x10))&&
            Ptr(m,data+index*8)==stage&&s.AsSpan(0x28,0x10).SequenceEqual(s2.AsSpan(0x28,0x10))&&s.AsSpan(0x50,0x14).SequenceEqual(s2.AsSpan(0x50,0x14)));
        foreach(var (address,bytes) in captured)Require(bytes.AsSpan(0x10,0x2c).SequenceEqual(m.Read(address+0x10,0x2c)));
        return new("ready","Aktivna etapa · izračun po pravilih nameščene igre",build,$"{job:x}:{index}:{planned}",(int)index,(int)count,now,planned,seconds,(int)delta,gradual,extra,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }
}
