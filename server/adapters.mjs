import { jsonRequest } from './network.mjs';
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const decimal=value=>typeof value==='number'||typeof value==='string'&&/^\d+(\.\d+)?$/.test(value)?finite(Number(value)):null;
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export async function refreshBalances(store,vault,fetcher) {
  const results=[];
  for(const provider of ['deepseek','openai']) {
    const key=vault.get(`${provider}.apiKey`);
    if(!key){results.push({provider,status:'unconfigured',message:'请配置服务端 API 密钥'});continue;}
    try {
      if(provider==='deepseek') {
        const data=await jsonRequest(fetcher,'https://api.deepseek.com/user/balance',{headers:{Authorization:`Bearer ${key}`}});
        if(!Array.isArray(data.balance_infos))throw new Error('INVALID_RESPONSE');
        for(const item of data.balance_infos) {
          const balance=decimal(item.total_balance);
          if(!['CNY','USD'].includes(item.currency)||balance===null)throw new Error('INVALID_RESPONSE');
          store.save('accounts',{name:`DeepSeek API (${item.currency})`,provider,type:'api',currency:item.currency,balance,total:null,resetsAt:null,note:'官方余额接口；包括赠送与充值余额',source:'api',threshold:null},`provider:deepseek:${item.currency}`);
        }
      } else {
        const now=new Date(),start=Math.floor(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)/1000);
        let next=null,cost=0,pages=0;
        do {
          const page=await jsonRequest(fetcher,`https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${Math.floor(Date.now()/1000)}&limit=31${next?`&page=${encodeURIComponent(next)}`:''}`,{headers:{Authorization:`Bearer ${key}`}});
          if(!Array.isArray(page.data))throw new Error('INVALID_RESPONSE');
          for(const bucket of page.data) {if(!Array.isArray(bucket.results))throw new Error('INVALID_RESPONSE');for(const item of bucket.results){if(item.amount?.currency!=='usd'||decimal(item.amount.value)===null)throw new Error('INVALID_RESPONSE');cost+=decimal(item.amount.value);}}
          next=page.has_more?page.next_page:null;if(page.has_more&&!next)throw new Error('INVALID_RESPONSE');if(++pages>10)throw new Error('PAGINATION_LIMIT');
        } while(next);
        store.save('accounts',{name:'OpenAI API 费用',provider,type:'api',currency:'USD',balance:null,total:null,resetsAt:null,note:`本月截至当前官方费用 ${cost.toFixed(6)} USD；组织 Costs API 需要管理员密钥，不提供余额`,source:'api',threshold:null},'provider:openai:USD');
      }
      results.push({provider,status:'ok'});
    } catch(error) { results.push({provider,status:'error',message:/^UPSTREAM_HTTP_\d+$/.test(error.message)?`服务返回 HTTP ${error.message.split('_').at(-1)}（请检查密钥和权限）`:'连接失败或源数据无效，请检查网络和权限'}); }
  }
  return {accounts:store.list('accounts'),results};
}
export async function refreshMarkets(store,vault,fetcher,settings,signal) {
  const results=[],quotes=[];
  const all=store.list('watchlist');
  for(const market of ['US','CN']) {
    const key=market==='US'?vault.get('market.alpacaKey'):vault.get('market.tushareToken'),secret=market==='US'?vault.get('market.alpacaSecret'):null;
    if(!key||market==='US'&&!secret){results.push({market,status:'unconfigured',message:'请配置行情密钥（A 股分钟接口需要对应权限）'});continue;}
    const watch=all.filter(x=>x.market===market);
    if(!watch.length){results.push({market,status:'ok',message:'自选列表为空'});continue;}
    let failures=0;
    for(const item of watch.slice(0,100)) {
      try {
        let quote;
        if(market==='US') {
          if(!/^[A-Za-z][A-Za-z0-9.]{0,14}$/.test(item.symbol))throw new Error('INVALID_SYMBOL');
          const feed=settings.market.alpacaFeed;
          const data=await jsonRequest(fetcher,`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(item.symbol)}/snapshot?feed=${feed}`,{signal,headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}});
          const price=finite(data.latestTrade?.p),stamp=data.latestTrade?.t,previous=finite(data.prevDailyBar?.c);
          if(price===null||price<=0||!validDate(stamp))throw new Error('NO_TRADE_DATA');
          quote={price,changePercent:previous&&previous>0?(price-previous)/previous*100:null,volume:finite(data.dailyBar?.v),asOf:stamp,source:`Alpaca ${feed}`,latency:feed==='delayed_sip'?'delayed':'realtime'};
        } else {
          if(!/^\d{6}\.(SH|SZ|BJ)$/i.test(item.symbol))throw new Error('INVALID_SYMBOL');
          const data=await jsonRequest(fetcher,'https://api.tushare.pro',{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_name:'rt_min',token:key,params:{ts_code:item.symbol.toUpperCase(),freq:'1MIN'},fields:'ts_code,time,close,vol'})});
          if(data.code!==0||!Array.isArray(data.data?.fields)||!Array.isArray(data.data?.items))throw new Error('TUSHARE_PERMISSION_OR_DATA');
          const rows=data.data.items.map(row=>Object.fromEntries(data.data.fields.map((field,index)=>[field,row[index]]))).filter(row=>row.ts_code===item.symbol.toUpperCase()).sort((a,b)=>String(b.time).localeCompare(String(a.time)));
          const latest=rows[0],price=finite(latest?.close);
          const stamp=latest?.time?.replace(' ','T')+'+08:00';
          if(price===null||price<=0||!validDate(stamp))throw new Error('NO_MINUTE_DATA');
          quote={price,changePercent:null,volume:finite(latest.vol),asOf:new Date(stamp).toISOString(),source:'Tushare rt_min 1MIN',latency:'minute'};
        }
        quotes.push({...quote,symbol:item.symbol,market,name:item.name,currency:market==='US'?'USD':'CNY',receivedAt:new Date().toISOString(),session:null});
      } catch {failures++;}
    }
    results.push({market,status:failures?'error':'ok',...(failures?{message:`${failures} 个标的获取失败，请检查代码、权限和网络`}:{})});
  }
  // Keep previous observations for failed refreshes; timestamps remain unchanged.
  const watched=new Set(all.map(x=>`${x.market}:${x.symbol}`));
  const merged=store.get('quotes',[]).filter(q=>watched.has(`${q.market}:${q.symbol}`)&&!quotes.some(n=>n.market===q.market&&n.symbol===q.symbol));
  merged.push(...quotes);
  const history=store.get('quoteHistory',[]),key=q=>`${q.market}:${q.symbol}:${q.asOf}`,seen=new Set(history.map(key));
  for(const quote of quotes)if(!seen.has(key(quote))){history.push(quote);seen.add(key(quote));}
  store.transaction(()=>{store.set('quotes',merged);store.set('quoteHistory',history.slice(-10000));});
  return {quotes:merged,results};
}
