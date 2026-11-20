import assert from 'node:assert/strict';
import {arch,cpus,platform,release} from 'node:os';
import type {launchSystemBrowser} from './p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

// i3-9100 estimate: ceil((11.55 ms M5 Pro Node/V8 + 1 ms renderer allowance) × 4300 / 1365).
// The calibration notes document the Geekbench 6 runs, GitHub Actions proxy and limitations.
// See docs/ui/evidence/v229-card36/filmstrip/README.md#b56-cpu-calibration.
const targetMs=40;

const boardStyles=`
  :host { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; font:14px sans-serif; }
  .column { display:flex; flex-direction:column; gap:4px; }
  .card { padding:4px 8px; border:1px solid #aaa; }
  .card.active { padding-block:6px; border-color:#369; }
`;

// Executed through CDP, so the DOM and the timing both belong to the renderer.
const measureBoardCpu=`(()=>{
  const host=document.createElement('div');
  host.style.cssText='position:fixed;top:0;left:-10000px;width:720px';
  const shadow=host.attachShadow({mode:'closed'});
  const styles=new CSSStyleSheet();
  styles.replaceSync(${JSON.stringify(boardStyles)});
  shadow.adoptedStyleSheets=[styles];
  const columns=Array.from({length:3},()=>{
    const column=document.createElement('div');
    column.className='column';
    shadow.append(column);
    return column;
  });
  const cards=Array.from({length:20},(_,id)=>{
    const card=document.createElement('div');
    card.className='card';
    card.textContent='Ticket '+id+' · Workbench refresh';
    return card;
  });
  const tickets=Array.from({length:128},(_,id)=>({id,priority:id*17%113}));

  function sample(){
    const start=performance.now();
    let checksum=0;
    for(let pass=0;pass<4000;pass++){
      const active=tickets.filter(ticket=>(ticket.id+pass)%3!==0)
        .sort((a,b)=>a.priority-b.priority);
      for(const ticket of active)checksum+=ticket.id+ticket.priority;
    }
    for(let pass=0;pass<4;pass++){
      for(const [index,card] of cards.entries()){
        columns[(index+pass)%3].append(card);
        card.classList.toggle('active',(index+pass+checksum)%3===0);
      }
      // Force layout after the column and style changes, as in the board's FLIP reads.
      checksum+=host.getBoundingClientRect().height;
    }
    return {ms:performance.now()-start,checksum};
  }

  document.body.append(host);
  try{
    sample();sample();
    const samples=Array.from({length:7},sample).sort((a,b)=>a.ms-b.ms);
    const median=samples[3];
    if(!median||median.checksum<=0)throw Error('B5.6 CPU calibration did not complete');
    return {hostMs:median.ms,hardwareConcurrency:navigator.hardwareConcurrency};
  }finally{host.remove();}
})()`;

export async function calibrateCard36bCpu(browser:Browser){
  const measurement:unknown=await browser.evaluate(measureBoardCpu);
  assert.ok(measurement&&typeof measurement==='object'&&'hostMs' in measurement&&'hardwareConcurrency' in measurement);
  const {hostMs,hardwareConcurrency}=measurement;
  assert.ok(typeof hostMs==='number'&&Number.isFinite(hostMs)&&hostMs>0,'B5.6 CPU calibration requires a positive renderer time');
  assert.ok(typeof hardwareConcurrency==='number'&&Number.isInteger(hardwareConcurrency)&&hardwareConcurrency>0);
  const rate=Math.min(8,Math.max(1,targetMs/hostMs));
  const version:unknown=await browser.command('Browser.getVersion');
  return {hostMs,targetMs,rate,hardwareConcurrency,cpuModel:cpus()[0]?.model||null,
    os:{platform:platform(),release:release(),arch:arch()},browser:version};
}
