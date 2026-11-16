using System.Buffers.Binary;
using System.ComponentModel;
using System.Diagnostics;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

// The read-only layout and signatures are based on ETS2LA/plugin (MIT).
// See licenses/ETS2LA-PLUGIN-LICENSE.txt. No game functions are called.
interface IGpsMemory { byte[] Read(long address, int length); }
sealed class GpsReadException(string code, string message) : Exception(message) { public string Code { get; } = code; }
record GpsNode(ulong Uid, double X, double Z, float Distance, float Time);
record GpsTarget(string Id, double X, double Z);
record RawGpsRoute(GpsNode[] Nodes, GpsTarget[] Targets, bool TargetsAvailable, string Fingerprint);
record GpsSignatures(int GlobalRva, int ManagerOffset, int BasePatternRva, int GpsPatternRva);

static class GpsSignatureLocator {
    public const string BasePattern = "48 8b ? ? ? ? ? 48 8b ? 48 8b ? 48 8b 80";
    public const string ManagerPattern = "48 8d 88 ? ? ? ? 48 85 c9 74 ? 48 8b 01 48 8d 54";
    static int[] Parse(string text) => text.Split(' ').Select(x => x == "?" ? -1 : Convert.ToInt32(x,16)).ToArray();
    public static bool Matches(ReadOnlySpan<byte> bytes, string text) {
        var pattern=Parse(text); if(bytes.Length<pattern.Length)return false;
        for(int i=0;i<pattern.Length;i++)if(pattern[i]>=0&&bytes[i]!=pattern[i])return false;
        return true;
    }
    public static int[] Scan(byte[] bytes,string text) {
        var pattern=Parse(text);var hits=new List<int>();
        for(int i=0;i<=bytes.Length-pattern.Length;i++) {
            if(bytes[i]!=pattern[0])continue;int j=1;
            while(j<pattern.Length&&(pattern[j]<0||bytes[i+j]==pattern[j]))j++;
            if(j==pattern.Length)hits.Add(i);
        }
        return hits.ToArray();
    }
    public static GpsSignatures Locate(string path) {
        using var file=File.OpenRead(path);using var pe=new PEReader(file);
        if(pe.PEHeaders.CoffHeader.Machine!=Machine.Amd64)throw new GpsReadException("unsupported_version","GPS bralnik potrebuje ETS2 x64.");
        var bases=new Dictionary<int,int>();var managers=new Dictionary<int,int>();
        foreach(var section in pe.PEHeaders.SectionHeaders.Where(s=>(s.SectionCharacteristics&SectionCharacteristics.MemExecute)!=0)) {
            var bytes=pe.GetSectionData(section.VirtualAddress).GetContent().ToArray();
            foreach(int hit in Scan(bytes,BasePattern)) {
                // Restrict the wildcard instruction to a RIP-relative load.
                if((bytes[hit+2]&0xc7)!=5)continue;
                int target=checked(section.VirtualAddress+hit+7+BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(hit+3)));
                if(pe.PEHeaders.SectionHeaders.Any(s=>target>=s.VirtualAddress&&target+8<=s.VirtualAddress+s.VirtualSize&&(s.SectionCharacteristics&SectionCharacteristics.MemWrite)!=0))bases.TryAdd(target,section.VirtualAddress+hit);
            }
            foreach(int hit in Scan(bytes,ManagerPattern)) {
                int offset=BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(hit+3));
                if(offset>=0x1000&&offset<=0x10000&&offset%8==0)managers.TryAdd(offset,section.VirtualAddress+hit);
            }
        }
        // Multiple call sites are acceptable only when they agree on the same value.
        if(bases.Count!=1||managers.Count!=1)throw new GpsReadException("signature_mismatch","Podpisi GPS-a niso enolični ali se ne ujemajo s to različico igre.");
        return new(bases.Keys.Single(),managers.Keys.Single(),bases.Values.Single(),managers.Values.Single());
    }
}

static class GpsMemoryDecoder {
    public static bool Pointer(long value) => value>=0x10000&&value<0x00007fffffff0000;
    static long Ptr(IGpsMemory m,long at) => BinaryPrimitives.ReadInt64LittleEndian(m.Read(at,8));
    static (long Data,int Count,byte[] Header) Vector(IGpsMemory m,long at,int max) {
        var h=m.Read(at,32);long data=BinaryPrimitives.ReadInt64LittleEndian(h.AsSpan(8));
        ulong size=BinaryPrimitives.ReadUInt64LittleEndian(h.AsSpan(16)),capacity=BinaryPrimitives.ReadUInt64LittleEndian(h.AsSpan(24));
        if(size>(ulong)max||capacity<size||capacity>1000000||(size>0&&!Pointer(data)))throw new GpsReadException("invalid_layout","Neveljavna velikost GPS podatkov; trasa ni uporabljena.");
        return(data,(int)size,h);
    }
    public static string ControllerType(IGpsMemory m,long controller) {
        long table=Ptr(m,controller),fn=Ptr(m,table+5*8);if(!Pointer(table)||!Pointer(fn))throw new GpsReadException("invalid_layout","Neveljaven krmilnik igre.");
        var code=m.Read(fn,16);
        // A getter may be reached through a relative jump. Never execute it.
        for(int i=0;code[0]==0xe9&&i<2;i++){fn=checked(fn+5+BinaryPrimitives.ReadInt32LittleEndian(code.AsSpan(1)));code=m.Read(fn,16);}
        long descriptor;
        if(code[0]==0x48&&code[1]==0x8d&&code[2]==0x05&&code[7]==0xc3)descriptor=checked(fn+7+BinaryPrimitives.ReadInt32LittleEndian(code.AsSpan(3)));
        else if(code[0]==0x48&&code[1]==0xb8&&code[10]==0xc3)descriptor=BinaryPrimitives.ReadInt64LittleEndian(code.AsSpan(2));
        else throw new GpsReadException("invalid_layout","Tipa krmilnika ni mogoče varno preveriti.");
        long slot=Ptr(m,descriptor),name=Ptr(m,slot);var text=m.Read(name,32);int end=Array.IndexOf(text,(byte)0);
        if(end<1)throw new GpsReadException("invalid_layout","Neveljaven tip krmilnika.");return Encoding.ASCII.GetString(text,0,end);
    }
    public static RawGpsRoute Read(IGpsMemory m,long global,int managerOffset) {
        long controller=Ptr(m,global);
        if(!Pointer(controller)||ControllerType(m,controller)!="game_ctrl")throw new GpsReadException("waiting_vehicle","Čakam na naloženo vozilo v ETS2.");
        long manager=checked(controller+managerOffset),task=Ptr(m,manager+0x28);
        if(task==0)return new([],[],false,"");
        if(!Pointer(task))throw new GpsReadException("invalid_layout","GPS naloga ni veljavna.");
        var vector=Vector(m,task+0x50,20000);
        if(vector.Count<2)return new([],[],false,"");
        var items=m.Read(vector.Data,checked(vector.Count*0x20));var nodeCache=new Dictionary<long,GpsNode>();
        GpsNode ReadNode(long ptr) {
            if(nodeCache.TryGetValue(ptr,out var cached))return cached;
            if(!Pointer(ptr))throw new GpsReadException("invalid_layout","GPS vsebuje neveljavno vozlišče.");
            var b=m.Read(ptr,0x38);ulong uid=BinaryPrimitives.ReadUInt64LittleEndian(b.AsSpan(0x30));
            double x=BinaryPrimitives.ReadInt32LittleEndian(b)/256.0,z=BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan(8))/256.0;
            if(uid==0||Math.Abs(x)>300000||Math.Abs(z)>300000)throw new GpsReadException("invalid_layout","Koordinate GPS-a niso veljavne.");
            return nodeCache[ptr]=new(uid,x,z,0,0);
        }
        var nodes=new GpsNode[vector.Count];float previous=float.MaxValue;
        for(int i=0;i<nodes.Length;i++) {
            var item=items.AsSpan(i*0x20,0x20);var node=ReadNode(BinaryPrimitives.ReadInt64LittleEndian(item));
            float distance=BinaryPrimitives.ReadSingleLittleEndian(item[0x14..]),time=BinaryPrimitives.ReadSingleLittleEndian(item[0x18..]);
            if(!float.IsFinite(distance)||!float.IsFinite(time)||distance<0||distance>1e8||time<0||time>1e8||distance>previous+10)throw new GpsReadException("invalid_layout","Razdalje GPS-a niso veljavne.");
            nodes[i]=node with {Distance=distance,Time=time};previous=distance;
        }
        var targets=new List<GpsTarget>();bool available=true;byte[]? targetHeader=null;long targetData=0;byte[]? targetItems=null;
        try {
            var waypoints=Vector(m,manager+0x1f8,128);targetHeader=waypoints.Header;targetData=waypoints.Data;
            targetItems=waypoints.Count>0?m.Read(waypoints.Data,waypoints.Count*0x18):[];
            for(int i=0;i<waypoints.Count;i++){var n=ReadNode(BinaryPrimitives.ReadInt64LittleEndian(targetItems.AsSpan(i*0x18+8)));targets.Add(new(n.Uid.ToString("x16"),n.X,n.Z));}
        } catch(GpsReadException) {available=false;targets.Clear();targetHeader=null;}
        // Refuse a snapshot if the route was replaced during the read.
        if(Ptr(m,global)!=controller||Ptr(m,manager+0x28)!=task||!vector.Header.AsSpan().SequenceEqual(m.Read(task+0x50,32))||!items.AsSpan().SequenceEqual(m.Read(vector.Data,items.Length)))throw new GpsReadException("updating","Igra ponovno računa GPS pot …");
        if(targetHeader!=null&&(!targetHeader.AsSpan().SequenceEqual(m.Read(manager+0x1f8,32))||(targetItems!.Length>0&&!targetItems.AsSpan().SequenceEqual(m.Read(targetData,targetItems.Length)))))throw new GpsReadException("updating","Igra spreminja cilje GPS-a …");
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData([available?(byte)1:(byte)0]);
        hash.AppendData(BitConverter.GetBytes(controller));hash.AppendData(BitConverter.GetBytes(task));
        // Hash every node, including the middle of equal-length routes and target order.
        foreach(var n in nodes)hash.AppendData(Encoding.ASCII.GetBytes($"{n.Uid:x16}:{n.X:R}:{n.Z:R};"));
        foreach(var t in targets)hash.AppendData(Encoding.ASCII.GetBytes($"{t.Id}:{t.X:R}:{t.Z:R};"));
        return new(nodes,targets.ToArray(),available,Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }
}

sealed class WindowsGpsMemory : IGpsMemory, IDisposable {
    readonly SafeProcessHandle handle;
    public long ModuleBase { get; }
    public GpsSignatures Signatures { get; }
    public string Version { get; }
    public string ExeSha256 { get; }
    public int ProcessId { get; }
    [DllImport("kernel32.dll",SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access,bool inherit,int id);
    [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool ReadProcessMemory(SafeProcessHandle process,nint address,[Out]byte[] buffer,nuint size,out nuint read);
    public WindowsGpsMemory(Process process,string gameId="ets2") {
        ProcessId=process.Id;var module=process.MainModule??throw new GpsReadException("access_denied","Podatki procesa ETS2 niso dosegljivi.");
        if(!string.Equals(Path.GetFileName(module.FileName),gameId=="ats"?"amtrucks.exe":"eurotrucks2.exe",StringComparison.OrdinalIgnoreCase))throw new GpsReadException("invalid_process","Proces se ne ujema z izbrano igro.");
        Version=FileVersionInfo.GetVersionInfo(module.FileName).FileVersion??"";
        using(var executable=File.OpenRead(module.FileName))ExeSha256=Convert.ToHexString(SHA256.HashData(executable));
        if(!Version.StartsWith("1.62."))throw new GpsReadException("unsupported_version",$"GPS bralnik je pripravljen za ETS2 / ATS 1.62.x; zaznano: {Version}.");
        Signatures=GpsSignatureLocator.Locate(module.FileName);ModuleBase=module.BaseAddress.ToInt64();
        // PROCESS_VM_READ | PROCESS_QUERY_INFORMATION. No write, operation or thread rights.
        handle=OpenProcess(0x0010|0x0400,false,process.Id);
        if(handle.IsInvalid){handle.Dispose();throw new GpsReadException("access_denied","Windows ne dovoli branja ETS2. Zaženi Fura GPS z enakimi pravicami kot HaulMP.");}
        try {
            if(!GpsSignatureLocator.Matches(Read(ModuleBase+Signatures.BasePatternRva,19),GpsSignatureLocator.BasePattern)||!GpsSignatureLocator.Matches(Read(ModuleBase+Signatures.GpsPatternRva,19),GpsSignatureLocator.ManagerPattern))throw new GpsReadException("signature_mismatch","Naloženi ETS2 ima drugačne podpise GPS-a.");
        } catch {handle.Dispose();throw;}
    }
    public byte[] Read(long address,int length) {
        if(!GpsMemoryDecoder.Pointer(address)||length<1||length>2_000_000||!GpsMemoryDecoder.Pointer(checked(address+length-1)))throw new GpsReadException("invalid_layout","Zavrnjeno neveljavno območje GPS podatkov.");
        var bytes=new byte[length];
        if(!ReadProcessMemory(handle,(nint)address,bytes,(nuint)length,out var read)||read!=(nuint)length)throw new GpsReadException("read_failed","GPS podatki trenutno niso berljivi; čakam na vozilo oziroma novo traso.");
        return bytes;
    }
    public void Dispose()=>handle.Dispose();
}
