package si.furagps.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Build;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import java.net.DatagramSocket;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.io.ByteArrayInputStream;
import org.json.JSONArray;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.widget.*;
import android.text.InputType;
import java.net.URI;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private WebView web,connection;
    private JSONObject translations;
    private volatile boolean discovering;
    private LinearLayout layout;
    private SharedPreferences preferences;
    private String server;
    private String layoutCss,layoutScript;
    private FrameLayout frame;
    private int failures;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(16,28,35));
        getWindow().setNavigationBarColor(Color.rgb(16,28,35));
        preferences=getSharedPreferences("furagps",MODE_PRIVATE);
        try{translations=new JSONObject(asset("strings.json"));}catch(Exception error){translations=new JSONObject();}
        layoutCss=asset("hud-layout.css");layoutScript=asset("hud-layout.js");
        if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,()->showAppMenu());
        if(saved!=null&&saved.getBoolean("mapVisible",false)&&!preferences.getString("server","").isEmpty()){server=preferences.getString("server","");openMap();}else showConnection();
    }
    private String asset(String name){try(InputStream input=getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toString("UTF-8");}catch(Exception error){throw new IllegalStateException("Manjkajo datoteke prikaza APK",error);}}
    private void disposeWeb(){if(web!=null){web.stopLoading();if(web.getParent() instanceof ViewGroup)((ViewGroup)web.getParent()).removeView(web);web.destroy();web=null;}}
    private void content(View view,boolean map){
        frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(16,28,35));frame.addView(view,new FrameLayout.LayoutParams(-1,-1));
        if(Build.VERSION.SDK_INT>=30){
            getWindow().setDecorFitsSystemWindows(false);getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
            WindowManager.LayoutParams params=getWindow().getAttributes();params.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;getWindow().setAttributes(params);
            frame.setOnApplyWindowInsetsListener((root,insets)->{android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());root.setPadding(safe.left,safe.top,safe.right,safe.bottom);return WindowInsets.CONSUMED;});
        }else{frame.setFitsSystemWindows(true);getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);}
        setContentView(frame);frame.post(()->{fullscreen(map);frame.requestApplyInsets();});
    }
    private void fullscreen(boolean map){
        if(Build.VERSION.SDK_INT>=30){WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null){controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);if(map)controller.hide(WindowInsets.Type.systemBars());else controller.show(WindowInsets.Type.systemBars());}}
        else getWindow().getDecorView().setSystemUiVisibility(map?View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY:View.SYSTEM_UI_FLAG_VISIBLE);
    }
    private void applyLayout(){
        if(web==null)return;
        String css=JSONObject.quote(layoutCss),large=preferences.getBoolean("largeText",false)?"true":"false";
        web.evaluateJavascript("(function(){if(window.FuraGPSHud&&window.FuraGPSHud.build>11){var old=document.getElementById('furagps-apk-layout');if(old)old.remove();}else{var s=document.getElementById('furagps-apk-layout');if(!s){s=document.createElement('style');s.id='furagps-apk-layout';document.head.append(s);}if(s.textContent!=="+css+")s.textContent="+css+";"+layoutScript+"}if(window.FuraGPSHud)window.FuraGPSHud.setLarge("+large+");})();",null);
    }
    private String language(){String value=preferences.getString("language",Locale.getDefault().getLanguage());return "sl en de hr it fr es".contains(value)&&value.length()==2?value:"en";}
    private String tr(String value){JSONArray row=translations.optJSONArray(value);int column=java.util.Arrays.asList("sl","en","de","hr","it","fr","es").indexOf(language());return row==null?value:row.optString(column,value);}
    public class LanguageBridge {@JavascriptInterface public void languageChanged(String value){if(java.util.Arrays.asList("sl","en","de","hr","it","fr","es").contains(value))preferences.edit().putString("language",value).apply();}}
    public class ConnectionBridge {
        @JavascriptInterface public void connect(String address){runOnUiThread(()->connectAddress(address));}
        @JavascriptInterface public void discover(){discoverPc();}
    }
    private void disposeConnection(){if(connection!=null){connection.stopLoading();connection.removeJavascriptInterface("FuraGPSConnectNative");connection.removeJavascriptInterface("FuraGPSNative");if(connection.getParent() instanceof ViewGroup)((ViewGroup)connection.getParent()).removeView(connection);connection.destroy();connection=null;}}
    private int dp(int value){return (int)(getResources().getDisplayMetrics().density*value);}
    private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(color);t.setPadding(0,dp(6),0,dp(6));return t;}
    private void showConnection(){
        disposeWeb();disposeConnection();connection=new WebView(this);connection.setBackgroundColor(Color.rgb(16,29,39));
        connection.getSettings().setJavaScriptEnabled(true);connection.getSettings().setDomStorageEnabled(true);connection.getSettings().setTextZoom(100);connection.getSettings().setUseWideViewPort(true);connection.getSettings().setLoadWithOverviewMode(true);connection.getSettings().setAllowFileAccess(false);connection.getSettings().setAllowContentAccess(false);
        connection.addJavascriptInterface(new ConnectionBridge(),"FuraGPSConnectNative");connection.addJavascriptInterface(new LanguageBridge(),"FuraGPSNative");
        connection.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String path=request.getUrl().getPath(),name=path==null?"":path.substring(1);
                if("https".equals(request.getUrl().getScheme())&&"furagps.local".equals(request.getUrl().getHost())&&java.util.Arrays.asList("connection.html","connection.css","connection.js","i18n.js","translations.js").contains(name))try{return new WebResourceResponse(name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"text/javascript","UTF-8",getAssets().open(name));}catch(Exception ignored){}
                return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view,String url){if(view!=connection)return;try{JSONObject config=new JSONObject();config.put("language",language());config.put("server",preferences.getString("server",""));view.evaluateJavascript("window.FuraGPSConnect&&FuraGPSConnect.init("+config.toString()+")",null);}catch(Exception ignored){}}
        });
        content(connection,false);connection.loadUrl("https://furagps.local/connection.html?lang="+language());
    }
    private void connectAddress(String address){
        try{URI uri=new URI(address);String host=uri.getHost();if(!"http".equals(uri.getScheme())||host==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals("/"))||!host.matches("\\d{1,3}(\\.\\d{1,3}){3}"))throw new Exception();
            String[] pieces=host.split("\\.");int[] parts=new int[4];for(int i=0;i<4;i++){parts[i]=Integer.parseInt(pieces[i]);if(parts[i]>255)throw new Exception();}
            boolean local=parts[0]==10||parts[0]==127||parts[0]==192&&parts[1]==168||parts[0]==172&&parts[1]>=16&&parts[1]<=31||parts[0]==169&&parts[1]==254;
            int port=uri.getPort()<0?28888:uri.getPort();if(!local||port<1||port>65535)throw new Exception();
            server="http://"+host+":"+port;preferences.edit().putString("server",server).apply();openMap();
        }catch(Exception error){if(connection!=null)connection.evaluateJavascript("window.FuraGPSConnect&&FuraGPSConnect.error("+JSONObject.quote(tr("Vpiši veljaven lokalni IP in vrata računalnika."))+")",null);}
    }
    private synchronized void discoverPc(){
        if(discovering)return;discovering=true;final WebView targetView=connection;
        new Thread(()->{JSONArray devices=new JSONArray();HashSet<String> seen=new HashSet<>();
            try(DatagramSocket socket=new DatagramSocket()){
                socket.setBroadcast(true);socket.setSoTimeout(300);byte[] query="FURAGPS?".getBytes("US-ASCII");HashSet<InetAddress> broadcasts=new HashSet<>();broadcasts.add(InetAddress.getByName("255.255.255.255"));
                for(NetworkInterface network:Collections.list(NetworkInterface.getNetworkInterfaces()))if(network.isUp()&&!network.isLoopback())for(java.net.InterfaceAddress address:network.getInterfaceAddresses())if(address.getBroadcast()!=null)broadcasts.add(address.getBroadcast());
                for(InetAddress address:broadcasts)try{socket.send(new DatagramPacket(query,query.length,address,28890));}catch(Exception ignored){}
                long until=android.os.SystemClock.elapsedRealtime()+3500;
                while(android.os.SystemClock.elapsedRealtime()<until){try{byte[] buffer=new byte[1024];DatagramPacket response=new DatagramPacket(buffer,buffer.length);socket.receive(response);JSONObject json=new JSONObject(new String(response.getData(),0,response.getLength(),"UTF-8"));int port=json.optInt("port",0);String host=response.getAddress().getHostAddress();if(!"furagps".equals(json.optString("service"))||port<1||port>65535||!seen.add(host+":"+port))continue;JSONObject device=new JSONObject();device.put("address","http://"+host+":"+port);device.put("name",json.optString("name","Fura GPS"));devices.put(device);}catch(java.net.SocketTimeoutException ignored){}}
            }catch(Exception ignored){}finally{discovering=false;runOnUiThread(()->{if(connection==targetView&&connection!=null)connection.evaluateJavascript("window.FuraGPSConnect&&FuraGPSConnect.found("+devices.toString()+")",null);});}
        },"FuraGPS-LAN-discovery").start();
    }
    private void openMap(){
        disposeConnection();
        View focused=getCurrentFocus();if(focused!=null){android.view.inputmethod.InputMethodManager input=(android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);if(input!=null)input.hideSoftInputFromWindow(focused.getWindowToken(),0);focused.clearFocus();}
        disposeWeb();
        failures=0;
        web=new WebView(this);web.setBackgroundColor(Color.rgb(16,28,35));
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.getSettings().setBuiltInZoomControls(false);
        web.getSettings().setDisplayZoomControls(false);web.getSettings().setUseWideViewPort(true);web.getSettings().setLoadWithOverviewMode(true);
        web.addJavascriptInterface(new LanguageBridge(),"FuraGPSNative");web.getSettings().setTextZoom(100);web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !request.getUrl().toString().startsWith(server+"/");}
            @Override public void onPageCommitVisible(WebView view,String url){if(view==web&&url.startsWith(server+"/"))applyLayout();}
            @Override public void onPageFinished(WebView view,String url){if(view==web&&url.startsWith(server+"/"))applyLayout();}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
                if(view==web&&request.isForMainFrame()&&failures++==0)runOnUiThread(()->new AlertDialog.Builder(MainActivity.this).setTitle(tr("Računalnik ni dosegljiv")).setMessage(tr("Preveri FuraGPS.exe, naslov računalnika, skupni Wi-Fi in dovoljenje programa v zasebnem omrežju Windows.")).setPositiveButton(tr("Nastavi povezavo"),(d,w)->showConnection()).setNegativeButton(tr("Poskusi znova"),(d,w)->openMap()).setCancelable(false).show());
            }
        });
        content(web,true);
        web.loadUrl(server+"/?lang="+language());
    }
    private void showAppMenu(){if(web==null){finish();return;}new AlertDialog.Builder(this).setTitle("Fura GPS 0.11.1").setItems(new String[]{tr("Nazaj na navigacijo"),tr("Velikost napisov"),tr("Osveži prikaz"),tr("Spremeni računalnik"),tr("Izhod")},(d,which)->{if(which==1)new AlertDialog.Builder(this).setTitle(tr("Velikost napisov")).setSingleChoiceItems(new String[]{tr("Kompaktno"),tr("Večji napisi")},preferences.getBoolean("largeText",false)?1:0,(dialog,selection)->{preferences.edit().putBoolean("largeText",selection==1).apply();applyLayout();dialog.dismiss();}).show();if(which==2&&web!=null)web.reload();if(which==3)showConnection();if(which==4)finish();}).show();}
    @Override public void onBackPressed(){showAppMenu();}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus&&web!=null)fullscreen(true);}
    @Override protected void onSaveInstanceState(Bundle saved){saved.putBoolean("mapVisible",web!=null);super.onSaveInstanceState(saved);}
    @Override protected void onDestroy(){disposeWeb();disposeConnection();super.onDestroy();}
}
