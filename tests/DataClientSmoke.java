package cn.goldsense.app;
import org.json.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

public class DataClientSmoke {
    public static void main(String[] args) throws Exception {
        Path fixtures=Paths.get(args[0]);
        String html=Files.readString(fixtures.resolve("sina_nmetal.txt"),StandardCharsets.UTF_8);
        JSONArray items=DataClient.parseMetals(html);
        if(items.length()<5) throw new AssertionError("Too few relevant articles: "+items.length());
        for(int i=0;i<items.length();i++){
            JSONObject item=items.getJSONObject(i);
            if(!item.getString("url").startsWith("https://finance.sina.com.cn/")) throw new AssertionError("Unsafe article URL");
            if(item.getString("title").contains("<"))throw new AssertionError("HTML leaked into title");
        }
        JSONObject parsed=new JSONObject().put("items",items).put("source","新浪财经 · 贵金属").put("fallback",false);
        Files.writeString(fixtures.resolve("news-parsed.json"),parsed.toString(),StandardCharsets.UTF_8);
        boolean blocked=false;try{DataClient.request("https://example.com/","GET",null);}catch(java.io.IOException e){blocked=true;}
        if(!blocked)throw new AssertionError("Untrusted host accepted");
        System.out.println("PASS: parsed "+items.length()+" recent gold/macro headlines; unrelated links filtered; untrusted host rejected.");
        if(args.length>1&&args[1].equals("live")){
            JSONObject q=DataClient.quote(),h=DataClient.history(),n=DataClient.news();
            Files.writeString(fixtures.resolve("java-quote.json"),q.toString(),StandardCharsets.UTF_8);
            Files.writeString(fixtures.resolve("java-history.json"),h.toString(),StandardCharsets.UTF_8);
            Files.writeString(fixtures.resolve("java-news.json"),n.toString(),StandardCharsets.UTF_8);
            System.out.println("PASS live Java network: quote instrument="+q.getString("heyue")+", historical rows="+h.getJSONArray("time").length()+", news="+n.getJSONArray("items").length());
        }
    }
}
