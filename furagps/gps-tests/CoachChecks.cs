using System.Buffers.Binary;
using System.IO.Compression;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;

static class CoachChecks {
    static void Check(bool condition,string message){if(!condition)throw new Exception(message);Console.WriteLine("PASS: "+message);}
    public static void Run(string[] args) {
        var m=new CoachFixture();const long module=0x140000000,ctrl=0x20000,economy=0x30000,profile=0x40000,job=0x50000,items=0x60000,stage=0x70000;
        m.I64(module+0x3715040,0);
        m.I64(module+0x3714fb0,ctrl);m.Unit(ctrl,"game_ctrl");m.I64(module+0x30aa900,economy);m.Put(economy,new byte[0x1a0]);m.I64(economy+0x18,profile);m.Put(profile,new byte[0x38]);m.I64(profile+0x30,job);
        m.Put(job,new byte[0x168]);m.Unit(job,"player_bus_job");m.I64(job+0x38,items);m.I64(job+0x40,3);m.I64(job+0x48,3);m.U32(job+0x58,0);m.I64(items,stage);
        m.Put(stage,new byte[0x64]);m.Unit(stage,"player_bus_job_stage");m.U32(stage+0x30,1010);m.U32(stage+0x54,uint.MaxValue);m.U32(economy+0x19c,1000);m.Float(ctrl+0x43b8,600);
        m.Put(module+0x2da5d60+0x110,new byte[0x18]);m.Put(module+0x2da5d60+0x116,[1]);
        CoachGameState Read()=>CoachMemoryDecoder.Read(m,module,"fixture");
        Check(Read().DelayMinutes==0&&Read().Stage==0&&Read().Stages==3,"Coach current-stage delay uses game next-checkpoint ETA and game clock");
        m.Float(ctrl+0x43b8,629.99f);Check(Read().DelayMinutes==0,"game float32 rounding below half minute");
        m.Float(ctrl+0x43b8,630);Check(Read().DelayMinutes==1,"game float32 rounding at half minute");
        Check(CoachMemoryDecoder.GameRound(-1.5f)==-1&&CoachMemoryDecoder.GameRound(2.5f)==3,"game round is floor(float32(x + 0.5)), including negative correction");
        m.Float(ctrl+0x43b8,600);m.Put(job+0x158,[1]);m.U32(job+0x164,1008);Check(Read().DelayMinutes==8,"waiting for earliest departure changes predicted delay like the game helper");
        m.U32(job+0x58,2);m.I64(items+16,stage);m.U32(stage+0x54,1001);Check(Read().DelayMinutes==0,"completed last stage bypasses earliest-departure bound");
        m.Put(job+0x158,[0]);m.U32(module+0x2da5d60+0x118,1);m.U32(stage+0x28,100);m.U32(stage+0x50,25);m.U32(stage+0x34,20);m.U32(stage+0x60,10);
        Check(Read().DelayMinutes==8&&Read().ScheduleAdjustment==8,"gradual timetable includes remaining-stage correction");
        m.U32(stage+0x50,100);Check(Read().DelayMinutes==0,"gradual correction expires at completed progress");
        Check(CoachMemoryDecoder.Adjustment(true,100,50,10,15)==-2&&CoachMemoryDecoder.Adjustment(true,100,200,20,10)==0,"signed budget difference and clamped progress");
        var before=Read().Scope;m.U32(job+0x58,1);m.I64(items+8,stage);Check(Read().Scope!=before,"next stage changes schedule scope even at identical planned time");
        m.U32(stage+0x30,uint.MaxValue);m.U32(stage+0x2c,1000);m.U32(stage+0x34,10);m.U32(stage+0x60,10);
        Check(Read().Planned==1010,"derived Coach arrival resolves from departure plus stage duration");
        m.U32(stage+0x2c,10000);m.U32(stage+0x34,585);m.U32(stage+0x28,573);m.U32(stage+0x50,214);m.U32(stage+0x60,479);m.U32(economy+0x19c,10215);m.Float(ctrl+0x43b8,17420.805f);
        Check(Read().Planned==10585&&Read().ScheduleAdjustment==66&&Read().DelayMinutes==-14,"live HaulMP regression: derived deadline and rolling schedule yield -14 minutes, not generic final-arrival estimate");
        const long previous=0x80000,owner=0x81000,handle=0x82000,session=0x83000,sub=0x84000;
        m.Put(previous,new byte[0x64]);m.Unit(previous,"player_bus_job_stage");m.U32(previous+0x30,1000);m.I64(previous+0x20,owner);m.I64(owner+0x58,handle);m.U32(handle+8,0x80000000);m.U32(handle+0x14,15);
        m.I64(stage+0x10,previous);m.U32(stage+0x2c,uint.MaxValue);m.U32(stage+0x34,100);m.U32(stage+0x38,7);
        Check(CoachMemoryDecoder.PlannedArrival(m,module,economy,stage,[])==1115,"derived departure follows previous arrival and configured layover");
        m.Put(session,new byte[0x18]);m.Put(session+0xb,[8]);m.I64(session+0x10,sub);m.Put(sub+0xc8,[5]);m.I64(module+0x3715040,session);
        Check(CoachMemoryDecoder.PlannedArrival(m,module,economy,stage,[])==1093,"multiplayer timetable omits layover and subtracts stage adjustment");
        m.I64(module+0x3715040,0);m.U32(previous+0x30,uint.MaxValue);m.U32(previous+0x2c,uint.MaxValue);m.I64(previous+0x10,stage);
        try{CoachMemoryDecoder.PlannedArrival(m,module,economy,stage,[]);throw new Exception("Cyclic timetable accepted");}catch(GpsReadException){Check(true,"cyclic derived timetable is rejected without recursion overflow");}
        m.U32(stage+0x30,1010);m.U32(economy+0x19c,1000);
        m.Float(ctrl+0x43b8,-1);Check(Read().State=="no_eta","missing next-checkpoint ETA clears live schedule");m.Float(ctrl+0x43b8,600);
        m.ChangeStage=true;try{Read();throw new Exception("Torn read accepted");}catch(GpsReadException){Check(true,"stage switch during memory read is rejected");}m.ChangeStage=false;
        m.I64(profile+0x30,0);Check(Read().State=="no_bus_job","leaving Coach job clears timetable");
        Check(!CoachMemoryDecoder.Compatible(m,module,"wrong-build"),"unknown executable is rejected before any offset access");
        var bytes=Encoding.UTF8.GetBytes("satisfaction_acceleration_limits[]: (6,6,6)\nsatisfaction_acceleration_limits[]: (1000,1000,11)\nfailure_acceleration_limit: (-1,-1,22)\nsatisfaction_accelaration_capture_time_s: 3\nsatisfaction_penalty_cooldown_time_s: 5\n");
        var rules=CoachRulesReader.Parse(bytes,"fixture");Check(rules.Limits.Length==2&&rules.Limits[0].Y==6&&rules.FailureLimits.X==-1&&rules.CaptureSeconds==3,"Coach rules retain all axes, disabled failure axes and timing parameters");
        var dir=Path.Combine(AppContext.BaseDirectory,"coach-fixtures");Directory.CreateDirectory(dir);var zipPath=Path.Combine(dir,"rules.scs");
        using(var file=File.Create(zipPath))using(var zip=new ZipArchive(file,ZipArchiveMode.Create)){using var entry=zip.CreateEntry("def/bus_economy_data.sii").Open();entry.Write(bytes);}
        Check(CoachRulesReader.ReadArchive(zipPath)!.SequenceEqual(bytes),"targeted ZIP mod rules match input without extracting other files");
        File.WriteAllBytes(Path.Combine(dir,"def.scs"),[1,2,3,4]);Check(CoachRulesReader.Load(dir).State=="reference","unreadable archive yields explicitly labelled reference rules");
        var logPath=Path.Combine(dir,"game.log.txt");File.WriteAllText(logPath,$"[fs] device {zipPath} mounted to scs pool.\n");
        Check(CoachRulesReader.Load(dir,logPath).State=="files","mounted mod rules are considered, disabled files are not scanned");
        if(args.Length>0) {
            using var image=new FileMemory(args[0]);
            Check(CoachMemoryDecoder.Compatible(image,module,Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args[0])))),"exact installed executable and all loaded-code guard regions match Coach adapter");
            image.Corrupt=true;Check(!CoachMemoryDecoder.Compatible(image,module,CoachMemoryDecoder.SupportedSha256),"patched loaded code is rejected even when the on-disk executable hash matches");image.Corrupt=false;
            var gameRoot=Path.GetFullPath(Path.Combine(Path.GetDirectoryName(args[0])!,"..",".."));
            var extracted=CoachRulesReader.ReadArchive(Path.Combine(gameRoot,"def.scs"))!;var installed=CoachRulesReader.Parse(extracted,"def.scs");
            Check(installed.Limits.SequenceEqual(rules.Limits)&&installed.FailureLimits==rules.FailureLimits&&installed.CooldownSeconds==5,"targeted HashFS reader recovers actual installed Coach rules");
        }
    }
    sealed class CoachFixture : IGpsMemory {
        readonly Dictionary<long,byte> bytes=[];long allocation=0x90000;public bool ChangeStage;int jobs;
        public void Put(long at,byte[] b){for(int i=0;i<b.Length;i++)bytes[at+i]=b[i];}
        public void I64(long at,long n)=>Put(at,BitConverter.GetBytes(n));
        public void U32(long at,uint n)=>Put(at,BitConverter.GetBytes(n));
        public void Float(long at,float n)=>Put(at,BitConverter.GetBytes(n));
        public void Unit(long at,string name){long table=allocation,getter=allocation+0x100,descriptor=allocation+0x200,slot=allocation+0x300,label=allocation+0x400;allocation+=0x1000;I64(at,table);I64(table+40,getter);var code=new byte[16];code[0]=0x48;code[1]=0x8d;code[2]=5;BinaryPrimitives.WriteInt32LittleEndian(code.AsSpan(3),(int)(descriptor-getter-7));code[7]=0xc3;Put(getter,code);I64(descriptor,slot);I64(slot,label);Put(label,new byte[32]);Put(label,Encoding.ASCII.GetBytes(name));}
        public byte[] Read(long at,int length){var b=new byte[length];for(int i=0;i<length;i++)if(!bytes.TryGetValue(at+i,out b[i]))throw new GpsReadException("read_failed","Fixture missing bytes");if(ChangeStage&&at==0x50000&&length==0x168&&++jobs%2==0)b[0x58]^=1;return b;}
    }
    sealed class FileMemory(string path) : IGpsMemory,IDisposable {
        public bool Corrupt;
        readonly Stream stream=File.OpenRead(path);readonly PEReader pe=new(File.OpenRead(path));
        public byte[] Read(long at,int length){int rva=checked((int)(at-0x140000000));var s=pe.PEHeaders.SectionHeaders.First(s=>rva>=s.VirtualAddress&&rva+length<=s.VirtualAddress+s.SizeOfRawData);stream.Position=s.PointerToRawData+rva-s.VirtualAddress;var b=new byte[length];stream.ReadExactly(b);if(Corrupt&&rva==0x5a8cc0)b[0]^=1;return b;}
        public void Dispose(){stream.Dispose();pe.Dispose();}
    }
}
