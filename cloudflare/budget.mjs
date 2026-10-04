const originalStatement=Symbol('original D1 statement');

// Count all D1 executions across authorization, retries and streamed persistence.
// Reject a whole batch before running it: no partial restore can consume the
// remaining allowance and then fail halfway through publishing its changes.
export function budgetDatabase(database,limit=50){
  let used=0;
  const reserve=count=>{
    if(used+count>limit)throw Object.assign(new Error('本次更新遇到并发或数据量过大，请分批处理或重试'),{statusCode:409});
    used+=count;
  };
  const wrap=statement=>({
    [originalStatement]:statement,
    bind(...values){return wrap(statement.bind(...values));},
    async first(...args){reserve(1);return statement.first(...args);},
    async all(...args){reserve(1);return statement.all(...args);},
    async run(...args){reserve(1);return statement.run(...args);},
    async raw(...args){reserve(1);return statement.raw(...args);},
  });
  return {
    prepare(sql){return wrap(database.prepare(sql));},
    async batch(statements){reserve(statements.length);return database.batch(statements.map(statement=>statement[originalStatement]??statement));},
  };
}
