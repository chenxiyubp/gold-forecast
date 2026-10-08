package cn.goldsense.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

/** Public data only; fixed endpoints, bounded responses, no credentials. */
public final class DataClient {
    private static final String SGE = "https://www.sge.com.cn";
    private static final String SINA = "https://finance.sina.com.cn";
    private static final Pattern LINKS = Pattern.compile("<a\\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern DATE = Pattern.compile("/(20\\d{2}-\\d{2}-\\d{2})/");
    private static final Pattern TOPIC = Pattern.compile("黄金|金价|沪金|上海金|贵金属|伦敦金|美联储|美元指数|美元走|美元涨|美元跌|降息|加息|非农|通胀|通缩");

    public static String request(String url, String method, String form) throws IOException {
        URL address = new URL(url);
        if (!"https".equals(address.getProtocol()) || !Arrays.asList("www.sge.com.cn", "finance.sina.com.cn", "feed.mix.sina.com.cn").contains(address.getHost())) throw new IOException("数据地址不受支持");
        HttpURLConnection c = (HttpURLConnection) address.openConnection();
        c.setConnectTimeout(12000); c.setReadTimeout(16000);
        c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method);
        // Request the HTML edition; Android UA triggers Sina's separate mobile redirect.
        // Keep the app identity explicit and retain the fixed HTTPS host allowlist.
        c.setRequestProperty("User-Agent", "GoldSentAnalysis/1.0.2");
        c.setRequestProperty("Referer", address.getHost().contains("sge") ? SGE+"/" : SINA+"/nmetal/");
        c.setRequestProperty("Accept", "application/json,text/html;q=0.9,*/*;q=0.8");
        if (form != null) {
            c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            try (OutputStream out = c.getOutputStream()) { out.write(form.getBytes(StandardCharsets.UTF_8)); }
        }
        try {
            int status=c.getResponseCode();
            if (status != 200) throw new IOException("数据源返回 HTTP " + status);
            try(InputStream in = c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] b=new byte[8192]; int n;
                while((n=in.read(b))!=-1) { out.write(b,0,n); if(out.size()>3_000_000) throw new IOException("响应超过安全大小"); }
                return out.toString("UTF-8");
            }
        } finally { c.disconnect(); }
    }
    public static JSONObject quote() throws Exception {
        JSONObject j = new JSONObject(request(SGE+"/graph/quotations?instid=Au99.99", "GET", null));
        if(!"Au99.99".equals(j.optString("heyue")) || !j.has("times") || !j.has("data")) throw new IOException("行情数据格式发生变化");
        return j;
    }
    public static JSONObject history() throws Exception {
        JSONObject j=new JSONObject(request(SGE+"/graph/Dailyhq", "POST", "instid=Au99.99"));
        if(!j.has("time") || j.getJSONArray("time").length()==0) throw new IOException("未返回历史行情");
        return j;
    }
    public static JSONArray parseMetals(String html) throws Exception {
        Matcher m=LINKS.matcher(html); LinkedHashMap<String,JSONObject> items=new LinkedHashMap<>();
        String cutoff=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).minusDays(7).toString();
        while(m.find()) {
            String url=m.group(1).replace("&amp;","&");
            if(url.startsWith("//")) url="https:"+url;
            if(url.startsWith("http://finance.sina.com.cn/")) url="https://"+url.substring(7);
            if(!url.startsWith(SINA+"/") || !url.contains("doc-")) continue;
            String title=clean(m.group(2)); Matcher date=DATE.matcher(url);
            if(title.length()<8 || title.length()>220 || !TOPIC.matcher(title).find() || !date.find()) continue;
            String day=date.group(1);
            if(day.compareTo(cutoff)<0 || items.containsKey(title)) continue;
            JSONObject item=new JSONObject(); item.put("title",title); item.put("url",url);
            item.put("date",day); item.put("precision","day"); item.put("source","新浪财经 · 贵金属");
            items.put(title,item); if(items.size()>=70) break;
        }
        if(items.isEmpty()) throw new IOException("贵金属页面未找到近七日新闻");
        return new JSONArray(items.values());
    }
    private static String clean(String value) {
        return value.replaceAll("<[^>]*>", "").replace("&nbsp;"," ").replace("&#160;"," ").replace("&amp;","&").replace("&quot;","\"").replace("&#39;","'").replace("&lt;","<").replace("&gt;",">").replaceAll("\\s+"," ").trim();
    }
    public static JSONObject news() throws Exception {
        try {
            return new JSONObject().put("items",parseMetals(request(SINA+"/nmetal/","GET",null))).put("source","新浪财经 · 贵金属").put("fallback",false);
        } catch(Exception primaryError) {
            JSONObject raw=new JSONObject(request("https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=100&page=1","GET",null));
            JSONArray all=raw.getJSONObject("result").getJSONArray("data"); JSONArray items=new JSONArray();
            for(int i=0;i<all.length();i++) {
                JSONObject x=all.getJSONObject(i); String title=clean(x.optString("title"));
                if(!TOPIC.matcher(title).find()) continue;
                String u=x.optString("url").replaceFirst("^http://finance\\.sina\\.com\\.cn/",SINA+"/");
                if(!u.startsWith(SINA+"/")) continue;
                long stamp=x.optLong("ctime",0)*1000;
                if(stamp<=0 || stamp<System.currentTimeMillis()-7L*86400000) continue;
                items.put(new JSONObject().put("title",title).put("url",u).put("publishedAt",stamp).put("precision","minute").put("source","新浪财经 · 宏观资讯"));
            }
            if(items.length()==0) throw new IOException("新闻源暂未返回相关资讯");
            return new JSONObject().put("items",items).put("source","新浪财经 · 宏观资讯（备用）").put("fallback",true);
        }
    }
}
