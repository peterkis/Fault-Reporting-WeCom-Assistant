function visiblePortion(node:HTMLElement):{start:number;end:number;height:number;width:number}|null{
  if(document.visibilityState!=='visible'||!document.hasFocus()||!node.isConnected||!node.textContent?.trim())return null;
  let top=0,left=0,right=window.innerWidth,bottom=window.innerHeight;
  for(let ancestor:HTMLElement|null=node;ancestor;ancestor=ancestor.parentElement){
    const style=getComputedStyle(ancestor);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return null;
    if(ancestor!==node&&(style.overflowY!=='visible'||style.overflowX!=='visible')){const box=ancestor.getBoundingClientRect();top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom);left=Math.max(left,box.left);right=Math.min(right,box.right);}
  }
  const box=node.getBoundingClientRect();if(box.width<=0||box.height<=0||box.left<left||box.right>right||box.bottom<=top||box.top>=bottom)return null;
  return {start:Math.max(0,top-box.top),end:Math.min(box.height,bottom-box.top),height:box.height,width:box.width};
}
export const hasForegroundText=(node:HTMLElement)=>visiblePortion(node)!==null;
export function foregroundTextReader(node:HTMLElement):()=>boolean{
  let height=0,width=0,seen:{start:number;end:number}[]=[];
  return()=>{
    const portion=visiblePortion(node);if(!portion)return false;
    if(height!==portion.height||width!==portion.width){height=portion.height;width=portion.width;seen=[];}
    const ranges=[...seen,{start:portion.start,end:portion.end}].sort((a,b)=>a.start-b.start);seen=[];
    for(const range of ranges){const previous=seen.at(-1);if(previous&&range.start<=previous.end+1)previous.end=Math.max(previous.end,range.end);else seen.push({...range});}
    const first=seen[0];return seen.length===1&&!!first&&first.start<=1&&first.end>=height-1;
  };
}
