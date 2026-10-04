export function generateReminders(store,settings) {
  const now=Date.now(),known=new Set(store.list('alerts').map(a=>a.eventKey));
  const alert=(eventKey,title,message,kind)=>{if(!known.has(eventKey)){store.save('alerts',{eventKey,title,message,kind,read:false});known.add(eventKey);}};
  for(const task of store.list('tasks')) {
    if(task.status==='completed'||!task.dueAt)continue;
    const remaining=Date.parse(task.dueAt)-now;
    if(remaining<=settings.notifications.taskHours*3600000)alert(`task:${task.id}:${task.dueAt}`,remaining<0?'任务已逾期':'任务即将截止',`${task.title} · ${task.dueAt}`,'task');
  }
  for(const account of store.list('accounts')) {
    const threshold=account.threshold??(account.currency==='percent'?settings.notifications.quotaBelow:settings.notifications.balanceBelow);
    if(account.balance!==null&&account.balance<threshold&&(!account.resetsAt||Date.parse(account.resetsAt)>now))alert(`balance:${account.id}:${threshold}`,'账户余额或额度偏低',`${account.name}：${account.balance} ${account.currency}`,'balance');
  }
  const codex=store.get('codex');
  if(codex?.syncedAt&&now-Date.parse(codex.syncedAt)<600000&&!codex.error) {
    const buckets=codex.rateLimitsByLimitId?Object.entries(codex.rateLimitsByLimitId):[['default',codex.rateLimits]];
    for(const [id,bucket] of buckets) for(const slot of ['primary','secondary']) {
      const window=bucket?.[slot];if(window?.usedPercent==null||window.resetsAt==null||window.resetsAt*1000<=now)continue;
      if(100-window.usedPercent<settings.notifications.quotaBelow)alert(`quota:${id}:${slot}:${window.resetsAt}`,'Codex 剩余额度偏低',`${id} ${slot}：剩余 ${100-window.usedPercent}%`,'quota');
    }
  }
  for(const watch of store.list('watchlist')) {
    const quote=store.get('quotes',[]).find(q=>q.market===watch.market&&q.symbol===watch.symbol);
    if(!quote||now-Date.parse(quote.asOf)>20*60000)continue;
    if(watch.targetAbove!==null&&quote.price>=watch.targetAbove)alert(`market:${watch.id}:above:${watch.targetAbove}`,'价格达到上限',`${watch.symbol}：${quote.price} ${quote.currency}`,'market');
    if(watch.targetBelow!==null&&quote.price<=watch.targetBelow)alert(`market:${watch.id}:below:${watch.targetBelow}`,'价格达到下限',`${watch.symbol}：${quote.price} ${quote.currency}`,'market');
  }
}
