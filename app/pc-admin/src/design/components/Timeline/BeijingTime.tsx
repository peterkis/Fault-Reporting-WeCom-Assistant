import {formatBeijingFull,formatBeijingShort} from '../../beijing-time';

export function BeijingTime({value,now}:{value:string;now?:number}){
  const full=formatBeijingFull(value);
  return <time dateTime={full?full.replace(' ','T')+'+08:00':undefined} title={full?full+'（北京时间）':undefined}>{formatBeijingShort(value,now)||'时间未记录'}</time>;
}
