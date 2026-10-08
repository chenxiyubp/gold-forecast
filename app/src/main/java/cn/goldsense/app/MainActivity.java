package cn.goldsense.app;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final String ORIGIN="https://appassets.androidplatform.net/assets/";
    private WebView web;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService pool=Executors.newFixedThreadPool(3);
    private final AtomicBoolean quoteBusy=new AtomicBoolean(), newsBusy=new AtomicBoolean(), historyBusy=new AtomicBoolean();
    private long quoteAt,newsAt,historyAt;
    private volatile boolean active, ready;
    private int interval=60;
    private String pendingExport;
    private final Runnable tick=new Runnable(){ public void run(){ if(active&&ready) refresh(false); handler.postDelayed(this,1000); }};

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        interval=getPreferences(0).getInt("interval",60);
        getWindow().setStatusBarColor(Color.rgb(36,39,36));
        getWindow().setNavigationBarColor(Color.rgb(36,39,36));
        web=new WebView(this); web.setBackgroundColor(Color.rgb(36,39,36)); setContentView(web);
        web.setOnApplyWindowInsetsListener((v,insets)->{
            int bottom=insets.getSystemWindowInsetBottom();
            if(Build.VERSION.SDK_INT>=30) { android.graphics.Insets edges=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime()); v.setPadding(edges.left,edges.top,edges.right,edges.bottom); }
            else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),bottom);
            return insets;
        });
        WebSettings settings=web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100); settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(),"GoldNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                String u=request.getUrl().toString();
                if(u.startsWith(ORIGIN)) {
                    String file=u.substring(ORIGIN.length()).split("\\?")[0];
                    if(!file.matches("[a-zA-Z0-9_.-]+")) return denied();
                    try { String mime=file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":"text/html";
                        return new WebResourceResponse(mime,"UTF-8",getAssets().open(file));
                    } catch(IOException e){return denied();}
                }
                return denied();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                String u=request.getUrl().toString(); if(u.startsWith(ORIGIN)) return false; openExternal(u); return true;
            }
            @Override public void onPageFinished(WebView view,String url){if(url.equals(ORIGIN+"index.html")){ready=true;send("settings",new JSONObject(),null);refresh(false);}}
        });
        web.loadUrl(ORIGIN+"index.html"); handler.post(tick);
        if(Build.VERSION.SDK_INT>=33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::handleBack);
    }
    private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
    private void openExternal(String url){
        try { Uri u=Uri.parse(url); String host=u.getHost(); if(!"https".equals(u.getScheme()) || host==null || !(host.equals("finance.sina.com.cn")||host.equals("www.sge.com.cn"))) return;
            startActivity(new Intent(Intent.ACTION_VIEW,u));
        }catch(Exception e){Toast.makeText(this,"没有可用的浏览器",Toast.LENGTH_SHORT).show();}
    }
    private void send(String kind,Object data,String error){
        if(isDestroyed()) return;
        try {
            JSONObject event=new JSONObject().put("kind",kind).put("fetchedAt",System.currentTimeMillis()).put("interval",interval);
            if(error==null) event.put("data",data); else event.put("error",error);
            String js="window.App&&window.App.receive("+event.toString()+");";
            handler.post(()->{if(!isDestroyed()&&ready) web.evaluateJavascript(js,null);});
        }catch(JSONException ignored){}
    }
    private interface Fetch {Object get() throws Exception;}
    private void fetch(String kind,AtomicBoolean busy,Fetch f){
        if(!busy.compareAndSet(false,true)) return;
        pool.execute(()->{try{send(kind,f.get(),null);}catch(Exception e){send(kind,null,e instanceof java.net.SocketTimeoutException?"连接超时，请稍后重试":e instanceof java.net.UnknownHostException?"无法连接数据源，请检查网络":e.getMessage()==null?"暂时无法获取数据":e.getMessage());}finally{busy.set(false);}});
    }
    private void refresh(boolean manual){
        if(!active||!ready) return; long now=System.currentTimeMillis();
        if(manual && now-quoteAt<12000){send("notice","请稍候再刷新，避免频繁请求数据源",null);return;}
        if(!manual&&interval==0&&quoteAt>0) return;
        if(manual||now-quoteAt>=Math.max(30,interval)*1000L){quoteAt=now;fetch("quote",quoteBusy,DataClient::quote);}
        if(manual||now-newsAt>=300000){newsAt=now;fetch("news",newsBusy,DataClient::news);}
        if(manual||now-historyAt>=3600000){historyAt=now;fetch("history",historyBusy,DataClient::history);}
    }
    private final class Bridge {
        @JavascriptInterface public void refresh(){handler.post(()->MainActivity.this.refresh(true));}
        @JavascriptInterface public void setInterval(int seconds){handler.post(()->{if(seconds==0||seconds==30||seconds==60||seconds==120||seconds==300){interval=seconds;getPreferences(0).edit().putInt("interval",seconds).apply();send("settings",new JSONObject(),null);}});}
        @JavascriptInterface public void openArticle(String url){handler.post(()->openExternal(url));}
        @JavascriptInterface public void exportCsv(String csv){
            if(csv==null||csv.length()>2_000_000)return;
            handler.post(()->{pendingExport=csv;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/csv").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,csv.startsWith("\"类型\",")?"金绪-验证档案.csv":"金绪-行情记录.csv");
                try{startActivityForResult(intent,40);}catch(Exception e){pendingExport=null;send("notice","此设备未提供文件保存服务",null);}});
        }
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==40){String text=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&text!=null){
            try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new IOException();out.write(("\ufeff"+text).getBytes(StandardCharsets.UTF_8));send("notice","记录已导出",null);}catch(Exception e){send("notice","保存失败，请重新选择位置",null);}
        }}
    }
    @Override protected void onResume(){super.onResume();active=true;if(web!=null)web.onResume();if(ready)refresh(false);}
    @Override protected void onPause(){active=false;if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){ready=false;handler.removeCallbacksAndMessages(null);pool.shutdownNow();if(web!=null){web.removeJavascriptInterface("GoldNative");web.destroy();}super.onDestroy();}
    private void handleBack(){if(ready)web.evaluateJavascript("window.App&&window.App.back()",value->{if(!"true".equals(value))finish();});else finish();}
    @Override public void onBackPressed(){handleBack();}
}
