using System.Text.RegularExpressions;

record GameInstallation(string? Path, HashSet<int> Dlcs) {
    public static readonly string[] DlcFiles = ["", "east", "north", "fr", "it", "balt", "balkan_e", "iberia", "balkan_w", "greece", "polar", "iceland"];
    public static readonly string[] AtsDlcFiles = ["", "nm", "or", "wa", "ut", "id", "co", "wy", "mt", "tx", "ok", "ks", "ne", "ar", "mo", "ia", "la", "il", "sd"];
    public static GameInstallation Find(string id="ets2") {
        var roots=new List<string>();
        if(OperatingSystem.IsWindows()) {
            var steam=Microsoft.Win32.Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam","SteamPath",null)?.ToString();
            if(steam!=null){roots.Add(steam);var vdf=System.IO.Path.Combine(steam,"steamapps","libraryfolders.vdf");if(File.Exists(vdf))foreach(Match m in Regex.Matches(File.ReadAllText(vdf),"\"path\"\\s*\"([^\"]+)\""))roots.Add(m.Groups[1].Value.Replace(@"\\",@"\"));}
        }
        roots.AddRange(DriveInfo.GetDrives().Where(d=>d.IsReady).SelectMany(d=>new[]{System.IO.Path.Combine(d.Name,"SteamLibrary"),System.IO.Path.Combine(d.Name,"Steam")}));
        var folder=id=="ats"?"American Truck Simulator":"Euro Truck Simulator 2";var exe=id=="ats"?"amtrucks.exe":"eurotrucks2.exe";
        var custom=Environment.GetEnvironmentVariable(id=="ats"?"FURAGPS_ATS_PATH":"FURAGPS_ETS2_PATH");
        var candidates=new[]{custom}.Concat(roots.Distinct().Select(r=>System.IO.Path.Combine(r,"steamapps","common",folder)));
        string? path=candidates.FirstOrDefault(p=>p!=null&&File.Exists(System.IO.Path.Combine(p,"bin","win_x64",exe)));
        var dlcs=new HashSet<int>();var files=id=="ats"?AtsDlcFiles:DlcFiles;
        if(path!=null)for(int i=1;i<files.Length;i++)if(File.Exists(System.IO.Path.Combine(path,$"dlc_{files[i]}.scs")))dlcs.Add(i);
        return new(path,dlcs);
    }
}

sealed class GameProfile {
    public string Id {get;}
    public string Name=>Id=="ats"?"American Truck Simulator":"Euro Truck Simulator 2";
    public string DataPath {get;}
    public GameInstallation Installation {get;}
    readonly Lazy<RoadMap> map;
    public RoadMap Map=>map.Value;
    public GameGpsReader? Gps {get;set;}
    public CoachRules? Rules {get;set;}
    public bool Available=>new[]{"graph.bin","geometry.bin","cities.json","roads.pmtiles","details.pmtiles"}.All(n=>File.Exists(System.IO.Path.Combine(DataPath,n)));
    public GameProfile(string id,string root){Id=id;DataPath=id=="ats"?System.IO.Path.Combine(root,"ats"):File.Exists(System.IO.Path.Combine(root,"ets2","graph.bin"))?System.IO.Path.Combine(root,"ets2"):root;Installation=GameInstallation.Find(id);map=new(()=>Available?new RoadMap(DataPath,Installation.Dlcs):throw new InvalidOperationException("Map data missing. Run Download-Maps.ps1."));}
}
sealed class GameCatalog {
    readonly Dictionary<string,GameProfile> games;
    readonly Func<string> active;
    public GameCatalog(string root,Func<string> active){this.active=active;games=new[]{"ets2","ats"}.ToDictionary(id=>id,id=>new GameProfile(id,root));}
    public IEnumerable<GameProfile> Games=>games.Values;
    public GameProfile For(string? requested)=>games.TryGetValue(requested??"",out var game)?game:games[active()=="ats"?"ats":"ets2"];
}
