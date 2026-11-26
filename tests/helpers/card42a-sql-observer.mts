import type {PostgresPool,PostgresPoolClient} from '../../app/server/src/platform/postgres-pool.mjs';

export const fullTicketCardSql=/SELECT 'ticket'::text AS kind,(?:(?!\bFROM\b)[\s\S])*?t\.ticket_no AS number(?:(?!\bFROM\b)[\s\S])*?p\.display_name AS assignee_name/u;
export const fullIntakeOrReviewCardSql=/SELECT '(?:intake|review)'::text AS kind,(?:(?!\bFROM\b)[\s\S])*?i\.intake_no AS number(?:(?!\bFROM\b)[\s\S])*?i\.reported_location_text AS location/u;

export function isFullCardProjection(sql:string):boolean {
  return fullTicketCardSql.test(sql)||fullIntakeOrReviewCardSql.test(sql);
}

export function spyPool(target:PostgresPool,beforeQuery?:(sql:string)=>Promise<void>|undefined){
  const queries:string[]=[];
  function observeQuery(owner:PostgresPool|PostgresPoolClient){
    return new Proxy(owner.query,{apply(fn,_receiver,args){
      if(typeof args[0]==='string'){
        queries.push(args[0]);
        const wait=beforeQuery?.(args[0]);
        if(wait)return wait.then(()=>Reflect.apply(fn,owner,args));
      }
      return Reflect.apply(fn,owner,args);
    }});
  }
  const query=observeQuery(target);
  const connect=new Proxy(target.connect,{apply(fn,_receiver,args){
    const acquired=Reflect.apply(fn,target,args);
    if(args.length)return acquired; // pool.query uses the driver's callback overload.
    return Promise.resolve(acquired).then((client:PostgresPoolClient)=>{
      const clientQuery=observeQuery(client);
      return new Proxy(client,{get(owner,key){
        const value=Reflect.get(owner,key);
        return key==='query'?clientQuery:typeof value==='function'?value.bind(owner):value;
      }});
    });
  }});
  const pool=new Proxy(target,{get(owner,key){
    if(key==='query')return query;
    if(key==='connect')return connect;
    const value=Reflect.get(owner,key);return typeof value==='function'?value.bind(owner):value;
  }});
  return {queries,pool};
}

/** Record pool reads and checked-out transaction reads during one request to an already running fixture. */
export async function observeWorkbenchRequest<T>(pool:PostgresPool,request:()=>Promise<T>){
  const originalQuery=pool.query,originalConnect=pool.connect,observed=spyPool(pool);
  pool.query=observed.pool.query;pool.connect=observed.pool.connect;
  try{return {value:await request(),sql:observed.queries};}
  finally{pool.query=originalQuery;pool.connect=originalConnect;}
}
