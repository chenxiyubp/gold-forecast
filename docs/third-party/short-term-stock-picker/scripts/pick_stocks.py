#!/usr/bin/env python3
"""
短线选股脚本 - 技术面+资金面综合筛选 (优化版)
"""

import akshare as ak
import pandas as pd
from datetime import datetime, timedelta
import time

MARKET_CAP_THRESHOLD = 15000000000  # 元

def get_trade_dates(n=25):
    dates = []
    d = datetime.now()
    while len(dates) < n:
        if d.weekday() < 5:
            dates.append(d.strftime('%Y%m%d'))
        d -= timedelta(days=1)
    return dates

def get_all_limit_up_stocks(trade_dates):
    """获取近20日涨停股"""
    all_data = {}
    
    print(f"📊 检查近20个交易日涨停情况...")
    
    for i, date in enumerate(trade_dates[:20]):
        try:
            df = ak.stock_zt_pool_em(date=date)
            if df is not None and len(df) > 0:
                for _, row in df.iterrows():
                    code = str(row['代码']).zfill(6)
                    name = row['名称']
                    
                    if code not in all_data:
                        all_data[code] = {
                            'name': name,
                            'count': 0,
                        }
                    
                    all_data[code]['count'] += 1
                    
                    if all_data[code]['count'] == 1:
                        circ_mv = row.get('流通市值', 0)
                        total_mv = row.get('总市值', 0)
                        all_data[code]['market_cap'] = circ_mv if circ_mv > 0 else total_mv
                        all_data[code]['industry'] = row.get('所属行业', '')
            
            if (i + 1) % 5 == 0:
                print(f"  已检查 {i+1}/20 个交易日... 累计 {len(all_data)} 只")
            time.sleep(0.2)
        except Exception as e:
            continue
    
    print(f"📈 近20日共有 {len(all_data)} 只股票涨停过")
    return all_data

def get_stock_hist_data(code):
    """获取股票历史数据"""
    try:
        if code.startswith(('600', '601', '603', '605', '688')):
            symbol = f'sh{code}'
        else:
            symbol = f'sz{code}'
        
        end_date = (datetime.now() + timedelta(days=1)).strftime('%Y%m%d')
        start_date = (datetime.now() - timedelta(days=40)).strftime('%Y%m%d')
        
        df = ak.stock_zh_a_daily(symbol=symbol, start_date=start_date, end_date=end_date)
        if df is None or len(df) < 20:
            return None
        
        return df.tail(25)
    except:
        return None

def analyze_stock(code, info):
    """分析单只股票"""
    name = info['name']
    
    # 剔除ST
    if 'ST' in str(name) or '*ST' in str(name) or '退' in str(name):
        return None
    
    # 板块过滤
    if not (code.startswith(('600', '601', '603', '605', '000', '001', '300', '688'))):
        return None
    
    # 市值过滤
    market_cap = info.get('market_cap', 0)
    if market_cap == 0 or market_cap > MARKET_CAP_THRESHOLD:
        return None
    
    # 获取历史数据
    df_hist = get_stock_hist_data(code)
    if df_hist is None:
        return None
    
    latest = df_hist.iloc[-1]
    close = latest['close']
    
    # 计算均线
    ma5 = df_hist['close'].rolling(5).mean().iloc[-1]
    ma10 = df_hist['close'].rolling(10).mean().iloc[-1]
    ma20 = df_hist['close'].rolling(20).mean().iloc[-1]
    
    # 均线检测
    if not (close >= ma5 and close >= ma10 and close >= ma20 and ma5 > ma10 > ma20):
        return None
    
    # 成交量分析
    vol_last5 = df_hist.tail(5)['volume'].mean()
    vol_prev5 = df_hist.tail(10)['volume'].iloc[:-5].mean()
    vol_ratio = vol_last5 / vol_prev5 if vol_prev5 > 0 else 1
    
    # 换手率
    turnover_rate = df_hist.tail(3)['turnover'].mean() * 100
    if turnover_rate > 10 or turnover_rate < 0.5:
        return None
    
    # 3日涨跌
    recent3 = df_hist.tail(3)
    price_up_3d = recent3.iloc[-1]['close'] > recent3.iloc[0]['close']
    
    # 技术评分
    tech_score = 20 + 10  # 均线多头基础分
    if vol_ratio >= 1.5:
        tech_score += 15
    elif vol_ratio >= 1.2:
        tech_score += 10
    else:
        tech_score += 5
    
    if price_up_3d and vol_ratio >= 1.2:
        tech_score += 10
    
    if 2 <= turnover_rate <= 8:
        tech_score += 5
    
    limit_up_count = info['count']
    total_score = limit_up_count * 20 + tech_score + vol_ratio * 5
    
    board = '科创板' if code.startswith('688') else ('创业板' if code.startswith('300') else ('深交所' if code.startswith(('000', '001')) else '上交所'))
    
    return {
        '代码': code,
        '名称': name,
        '涨停次数(近20日)': limit_up_count,
        '流通市值(亿)': round(market_cap / 100000000, 2),
        '最新价': round(close, 2),
        'MA5': round(ma5, 2),
        'MA10': round(ma10, 2),
        'MA20': round(ma20, 2),
        '换手率': round(turnover_rate, 2),
        '量比(近5日)': round(vol_ratio, 2),
        '3日涨跌': '↑' if price_up_3d else '↓',
        '技术评分': tech_score,
        '综合评分': round(total_score, 1),
        '板块': board,
        '所属行业': info.get('industry', '')
    }

def main():
    print("=" * 70)
    print("📈 短线强势股筛选 (技术面+资金面综合)")
    print("=" * 70)
    print("筛选条件：")
    print("  1. A股/深证/创业板/科创板")
    print("  2. 剔除ST及退市类")
    print("  3. 总市值 ≤ 150亿")
    print("  4. 近20交易日有涨停")
    print("  5. 股价站稳5/10/20日均线 & 均线多头")
    print("  6. 换手率合理区间 (0.5%-10%)")
    print("  7. 成交量放量")
    print("=" * 70)
    
    trade_dates = get_trade_dates(25)
    all_stocks = get_all_limit_up_stocks(trade_dates)
    
    if not all_stocks:
        return
    
    results = []
    analyzed = 0
    
    print(f"\n🔍 开始技术面分析...")
    
    for code, info in all_stocks.items():
        analyzed += 1
        result = analyze_stock(code, info)
        if result:
            results.append(result)
            print(f"  ✅ {code} {info['name']} - 评分: {result['综合评分']}")
        
        if analyzed % 50 == 0:
            print(f"  已分析 {analyzed}/{len(all_stocks)} 只... 符合条件: {len(results)}")
        
        time.sleep(0.25)  # 避免请求过快
    
    if not results:
        print("\n⚠️ 未找到符合条件的股票")
        return
    
    df_results = pd.DataFrame(results)
    df_results = df_results.sort_values('综合评分', ascending=False)
    
    print(f"\n✅ 筛选完成！找到 {len(df_results)} 只短线强势股")
    print("=" * 130)
    
    display_cols = ['代码', '名称', '涨停次数(近20日)', '流通市值(亿)', '最新价', 'MA5', 'MA10', 'MA20', 
                    '换手率', '量比(近5日)', '3日涨跌', '综合评分', '板块', '所属行业']
    print(df_results[display_cols].head(50).to_string(index=False))
    
    output_path = '/Users/lulei/.openclaw/workspace/skills/short-term-stock-picker/result.csv'
    df_results.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"\n📁 结果已保存到: {output_path}")

if __name__ == "__main__":
    main()