const offsetMs=8*60*60*1000;

/** SQL display timestamps are Beijing time; ISO timestamps retain their explicit zone. */
export function formatBeijingFull(value:string):string{
  const zoned=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)?value.replace(' ','T')+'+08:00':value;
  if(!/(?:Z|[+-]\d{2}:\d{2})$/u.test(zoned))return '';
  const epoch=Date.parse(zoned);
  return Number.isFinite(epoch)?new Date(epoch+offsetMs).toISOString().slice(0,19).replace('T',' '):'';
}

export function formatBeijingShort(value:string,now:number=Date.now()):string{
  const full=formatBeijingFull(value);
  if(!full||!Number.isFinite(now))return '';
  return full.slice(full.slice(0,4)===new Date(now+offsetMs).getUTCFullYear().toString()?5:0,16);
}
