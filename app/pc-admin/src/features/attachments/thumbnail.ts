/** One decoded image/video at a time. Server image validation caps originals at 16 MP; retain only a small JPEG. */
export async function mediaThumbnail(blob:Blob,video:boolean,signal:AbortSignal):Promise<Blob>{
  signal.throwIfAborted();
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw new Error('THUMBNAIL_UNAVAILABLE');
  const draw=(source:CanvasImageSource,width:number,height:number)=>{if(!width||!height)throw new Error('THUMBNAIL_UNAVAILABLE');const scale=Math.min(1,640/width,400/height);canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));context.drawImage(source,0,0,canvas.width,canvas.height);};
  if(video){
    const element=document.createElement('video'),url=URL.createObjectURL(blob);element.muted=true;element.preload='auto';element.playsInline=true;
    try{await new Promise<void>((resolve,reject)=>{
      const finish=(error?:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);element.onloadeddata=null;element.onerror=null;if(error)reject(error);else resolve();};
      const abort=()=>finish(new DOMException('Aborted','AbortError')),timer=window.setTimeout(()=>finish(new Error('THUMBNAIL_TIMEOUT')),8_000);
      element.onloadeddata=()=>finish();element.onerror=()=>finish(new Error('THUMBNAIL_UNAVAILABLE'));signal.addEventListener('abort',abort,{once:true});element.src=url;
    });signal.throwIfAborted();draw(element,element.videoWidth,element.videoHeight);}
    finally{element.pause();element.removeAttribute('src');element.load();URL.revokeObjectURL(url);}
  }else{
    const bitmap=await createImageBitmap(blob);
    try{signal.throwIfAborted();draw(bitmap,bitmap.width,bitmap.height);}finally{bitmap.close();}
  }
  const result=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('THUMBNAIL_UNAVAILABLE')),'image/jpeg',.75));
  signal.throwIfAborted();if(result.size>512*1024)throw new Error('THUMBNAIL_TOO_LARGE');return result;
}
