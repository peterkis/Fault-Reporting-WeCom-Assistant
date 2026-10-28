export interface ActivityActorColor {
  readonly backgroundColor:string;
  readonly color:string;
}

type ActorRecord={actor:string|null;audience:string};
const actorLabels=new Map([['SYSTEM','系统'],['PILOT_USER','工作人员'],['REPORTER','报修人'],['WORKER','系统'],['RULE_ENGINE','系统'],['SERVICE','系统']]);

// The current query exposes actor labels, not a separate participant identity.
export function activityActorName(record:ActorRecord):string{
  return record.actor?actorLabels.get(record.actor)??record.actor:record.audience==='REPORT'?'报修人':'系统';
}

// Reference-inspired pastel backgrounds with independently checked dark text.
const palette:readonly ActivityActorColor[]=[
  {backgroundColor:'#e3e5f8',color:'#4a518c'},
  {backgroundColor:'#f5e0e8',color:'#854157'},
  {backgroundColor:'#deeaf5',color:'#395f81'},
  {backgroundColor:'#daeceb',color:'#2c6861'},
  {backgroundColor:'#f5ebd9',color:'#856426'},
  {backgroundColor:'#eae4f6',color:'#624e84'},
  {backgroundColor:'#deece4',color:'#3a6649'},
  {backgroundColor:'#f4e4db',color:'#824d2d'},
];
const hex=(channels:readonly number[])=>'#'+channels.map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');

function unusedColor(name:string,used:ReadonlySet<string>):ActivityActorColor{
  let hash=0;for(const character of name)hash=(hash*31+(character.codePointAt(0)??0))>>>0;
  for(let offset=0;offset<palette.length;offset++){
    const candidate=palette[(hash+offset)%palette.length];
    if(candidate&&!used.has(candidate.backgroundColor))return candidate;
  }
  // Do not wrap the base palette when another participant arrives. The odd
  // multiplier visits distinct RGB pastels; the bounded search cannot hang.
  for(let offset=0;offset<=used.size;offset++){
    const value=((used.size+offset)*977)%262144;
    const channels=[192+((value>>12)&63),192+((value>>6)&63),192+(value&63)];
    const backgroundColor=hex(channels);
    if(!used.has(backgroundColor))return {backgroundColor,color:hex(channels.map(channel=>48+(channel-192)/2))};
  }
  throw new Error('ACTIVITY_ACTOR_COLOR_SPACE_EXHAUSTED');
}

/** Append participants without changing previous assignments or mutating them. */
export function extendActivityActorColors(previous:ReadonlyMap<string,ActivityActorColor>,records:readonly ActorRecord[]):ReadonlyMap<string,ActivityActorColor>{
  let next:Map<string,ActivityActorColor>|undefined;
  const used=new Set(Array.from(previous.values(),value=>value.backgroundColor));
  for(const record of records){
    const name=activityActorName(record);
    if((next??previous).has(name))continue;
    const color=unusedColor(name,used);
    next??=new Map(previous);next.set(name,color);used.add(color.backgroundColor);
  }
  return next??previous;
}
