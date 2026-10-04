import { refreshMarkets } from './adapters.mjs';

export function createMarketCoordinator({store,vault,fetcher,settings,testMode=false,scheduler}) {
  const clock=scheduler||{setTimeout,clearTimeout};
  const scheduled=!testMode||!!scheduler;
  let timer=null,flight=null,controller=null,cached=null,cachedAt=0,generation=0,closed=false;
  const configured=()=>store.list('watchlist').some(item=>item.market==='US'?vault.has('market.alpacaKey')&&vault.has('market.alpacaSecret'):vault.has('market.tushareToken'));
  const cancelTimer=()=>{if(timer!==null){clock.clearTimeout(timer);timer=null;}};
  const refresh=()=>{
    if(closed)return Promise.resolve({quotes:store.get('quotes',[]),results:[]});
    if(flight)return flight;
    if(cached&&Date.now()-cachedAt<30000)return Promise.resolve(cached);
    const version=generation;controller=new AbortController();
    flight=refreshMarkets(store,vault,fetcher,settings(),controller.signal).then(result=>{
      if(!closed&&generation===version){cached=result;cachedAt=Date.now();}return result;
    }).finally(()=>{flight=null;controller=null;});
    return flight;
  };
  const arm=()=>{
    cancelTimer();if(closed||!scheduled||!configured())return;
    timer=clock.setTimeout(async()=>{
      timer=null;try{await refresh();}catch{/* Adapters report source failures without exposing provider bodies. */}finally{arm();}
    },Math.max(30,settings().market.refreshSeconds)*1000);
    timer?.unref?.();
  };
  const invalidate=()=>{generation++;cached=null;cachedAt=0;controller?.abort();arm();};
  arm();
  return {refresh,invalidate,async close(){closed=true;cancelTimer();controller?.abort();await flight?.catch(()=>{});}};
}
