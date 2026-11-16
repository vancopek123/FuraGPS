using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

record CoachAxis(double X,double Y,double Z);
record CoachRules(string State,string Source,string Message,string? Fingerprint,CoachAxis[] Limits,CoachAxis FailureLimits,double CaptureSeconds,double CooldownSeconds) {
    public static readonly CoachRules Reference=new("reference","ETS2 1.62 · referenca","Lokalnih pravil ni mogoče potrditi; G-prikaz je ocena.",null,
        [new(6,6,6),new(1000,1000,11)],new(-1,-1,22),3,5);
}

static class CoachRulesReader {
    const string Entry="def/bus_economy_data.sii";
    // SCS's old CityHash64 of this ONE fixed path. No general hash implementation.
    const ulong EntryHash=0x0391ef8d347d2458;
    static double Number(string text)=>double.Parse(text,CultureInfo.InvariantCulture);
    public static CoachRules Parse(byte[] bytes,string source) {
        string text=Regex.Replace(Encoding.UTF8.GetString(bytes),@"//[^\r\n]*|/\*[\s\S]*?\*/","");
        if(text.Contains("@include",StringComparison.Ordinal))throw new InvalidDataException("Included rules need runtime verification.");
        const string number=@"(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)";
        CoachAxis[] Vectors(string key)=>Regex.Matches(text,Regex.Escape(key)+@"\s*(?:\[\s*\d*\s*\])?\s*:\s*\(\s*"+number+@"\s*,\s*"+number+@"\s*,\s*"+number+@"\s*\)")
            .Select(m=>new CoachAxis(Number(m.Groups[1].Value),Number(m.Groups[2].Value),Number(m.Groups[3].Value))).ToArray();
        double Scalar(string key){var m=Regex.Match(text,Regex.Escape(key)+@"\s*:\s*"+number);if(!m.Success)throw new InvalidDataException("Missing Coach rule.");return Number(m.Groups[1].Value);}
        var limits=Vectors("satisfaction_acceleration_limits");var failure=Vectors("failure_acceleration_limit");
        double capture=Scalar("satisfaction_accelaration_capture_time_s"),cooldown=Scalar("satisfaction_penalty_cooldown_time_s");
        if(limits.Length is <1 or >16||failure.Length!=1||limits.Any(v=>new[]{v.X,v.Y,v.Z}.Any(n=>!double.IsFinite(n)||n<=0||n>10000))||
            new[]{failure[0].X,failure[0].Y,failure[0].Z}.Any(n=>!double.IsFinite(n)||n<-1||n>10000)||capture is <0 or >60||cooldown is <0 or >60)throw new InvalidDataException("Unexpected Coach rules.");
        return new("files",source,"Meje iz lokalnih datotek; G-prikaz je ocena, strežniške spremembe niso potrjene.",Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),limits,failure[0],capture,cooldown);
    }
    public static CoachRules Load(string? gamePath,string? logPath=null) {
        if(gamePath==null)return CoachRules.Reference;
        var paths=new List<string>{Path.Combine(gamePath,"def.scs")};int unknown=0;
        // The log supplies mounted files only. Never enumerate disabled user mods.
        if(logPath!=null&&File.Exists(logPath))try {
            using var file=new FileStream(logPath,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
            if(file.Length<=32_000_000)using(var reader=new StreamReader(file)) {
                var log=reader.ReadToEnd();
                foreach(Match match in Regex.Matches(log,@"\[fs\] device (.+?) mounted to scs pool\.")) {
                    var path=match.Groups[1].Value.Trim();if(Path.IsPathFullyQualified(path)&&File.Exists(path))paths.Add(path);
                }
            }
        }catch(IOException){unknown++;}catch(UnauthorizedAccessException){unknown++;}
        CoachRules result=CoachRules.Reference;
        foreach(var path in paths.AsEnumerable().Reverse().Distinct(StringComparer.OrdinalIgnoreCase).Reverse().Take(1024))try {
            var bytes=ReadArchive(path);if(bytes!=null)result=Parse(bytes,Path.GetFileName(path));
        }catch(Exception ex)when(ex is IOException or InvalidDataException or UnauthorizedAccessException or ArgumentException or OverflowException or FormatException){unknown++;}
        if(unknown>0&&result.State=="files")result=result with {Message="Meje iz lokalnih datotek; del arhivov ni berljiv. G-prikaz in strežniške spremembe niso potrjeni."};
        return result;
    }
    static byte[] ReadAt(Stream stream,long at,int size,int cap) {
        if(at<0||size<0||size>cap||at>stream.Length-size)throw new InvalidDataException("Archive bounds.");
        stream.Position=at;var bytes=new byte[size];stream.ReadExactly(bytes);return bytes;
    }
    static byte[] Inflate(byte[] bytes,int expected,int cap) {
        if(expected<0||expected>cap)throw new InvalidDataException("Archive output bounds.");
        using var input=new MemoryStream(bytes);using var zip=new ZLibStream(input,CompressionMode.Decompress);
        var output=new byte[expected];zip.ReadExactly(output);if(zip.ReadByte()!=-1)throw new InvalidDataException("Archive size mismatch.");return output;
    }
    // Bounded targeted HashFS v2 reader. Header/index layout: scs_tools FORMAT.md
    // (MIT, see credits). Extracts only the single SII above, never game assets.
    public static byte[]? ReadArchive(string path) {
        using var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
        var h=ReadAt(file,0,(int)Math.Min(52,file.Length),52);
        if(h.Length>=4&&h[0]=='P'&&h[1]=='K') {
            file.Position=0;using var zip=new ZipArchive(file,ZipArchiveMode.Read);
            var entry=zip.GetEntry(Entry);if(entry==null)return null;
            if(entry.Length>1_000_000)throw new InvalidDataException("Coach SII too large.");
            using var stream=entry.Open();var bytes=new byte[(int)entry.Length];stream.ReadExactly(bytes);return bytes;
        }
        if(h.Length!=52||!h.AsSpan(0,4).SequenceEqual("SCS#"u8)||BinaryPrimitives.ReadUInt16LittleEndian(h.AsSpan(4))!=2||BinaryPrimitives.ReadUInt16LittleEndian(h.AsSpan(6))!=0||!h.AsSpan(8,4).SequenceEqual("CITY"u8))throw new InvalidDataException("Unsupported archive.");
        uint U32(byte[] b,int i)=>BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan(i));
        long U64(int i)=>checked((long)BinaryPrimitives.ReadUInt64LittleEndian(h.AsSpan(i)));
        int count=checked((int)U32(h,12));if(count>4_000_000)throw new InvalidDataException("Index too large.");
        var entries=Inflate(ReadAt(file,U64(28),checked((int)U32(h,16)),64_000_000),checked(count*16),64_000_000);
        int lo=0,hi=count-1,found=-1;
        while(lo<=hi){int mid=lo+(hi-lo)/2;ulong hash=BinaryPrimitives.ReadUInt64LittleEndian(entries.AsSpan(mid*16));if(hash<EntryHash)lo=mid+1;else if(hash>EntryHash)hi=mid-1;else{found=mid*16;break;}}
        if(found<0)return null;
        var metadata=Inflate(ReadAt(file,U64(36),checked((int)U32(h,24)),64_000_000),checked((int)U32(h,20)*4),64_000_000);
        int start=checked((int)U32(entries,found+8)),parts=BinaryPrimitives.ReadUInt16LittleEndian(entries.AsSpan(found+12));
        if(start<0||parts>64||(long)start+parts>metadata.Length/4)throw new InvalidDataException("Metadata bounds.");
        for(int j=0;j<parts;j++) {
            uint descriptor=U32(metadata,(start+j)*4);if((descriptor&0x80000000)==0)continue;
            int at=checked((int)(descriptor&0xffffff)*4);if(at>metadata.Length-16)throw new InvalidDataException("Data header bounds.");
            uint packed=U32(metadata,at);int size=(int)(U32(metadata,at+4)&0xffffff),compressed=(int)(packed&0xffffff),mode=(int)(packed>>24)&0xf0;
            var raw=ReadAt(file,(long)U32(metadata,at+12)*16,compressed,1_000_000);
            return mode==0&&raw.Length==size?raw:mode==0x10?Inflate(raw,size,1_000_000):throw new InvalidDataException("Unsupported Coach compression.");
        }
        throw new InvalidDataException("Missing Coach data.");
    }
}
