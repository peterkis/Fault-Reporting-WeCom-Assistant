// Isolated image codec entry. Invoked only by the existing bounded Worker transcoder.
import sharp from 'sharp';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {H5_MEDIA_LIMITS,inspectMedia} from './yxx-h5-media-format.mjs';

export async function compressH5Image(input:Buffer,mime:string,maximum:number){
  inspectMedia(input,'IMAGE',mime);
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>H5_MEDIA_LIMITS.IMAGE)throw Error('YXX_MEDIA_INPUT_INVALID');
  sharp.concurrency(1);sharp.cache(false);
  const options={limitInputPixels:16_777_216,failOn:'error' as const};
  const metadata=await sharp(input,options).metadata();
  if((metadata.pages??1)!==1)throw Error('YXX_MEDIA_ANIMATION_UNSUPPORTED');
  const rotated=[5,6,7,8].includes(metadata.orientation??1),width=rotated?metadata.height:metadata.width,height=rotated?metadata.width:metadata.height;
  const {data,info}=await sharp(input,options).autoOrient().keepIccProfile()
    .webp({quality:95,lossless:mime==='image/png'||metadata.hasAlpha===true,alphaQuality:100,smartSubsample:true,effort:4,exact:true})
    .timeout({seconds:8}).toBuffer({resolveWithObject:true});
  if(info.width!==width||info.height!==height||!data.length||data.length>maximum){data.fill(0);throw Error('YXX_MEDIA_COMPRESSED_SIZE_LIMIT');}
  inspectMedia(data,'IMAGE','image/webp');return data;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let source:Buffer|undefined,output:Buffer|undefined;
  try{
    const [input,target,mime,limit,...extra]=process.argv.slice(2);
    if(!input||!target||!mime||extra.length||basename(input)!=='input.media'||basename(target)!=='optimized.webp'||dirname(input)!==dirname(target)||!basename(dirname(input)).startsWith('yxx-transcode-'))throw Error('YXX_MEDIA_INPUT_INVALID');
    const stat=await lstat(input);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>H5_MEDIA_LIMITS.IMAGE)throw Error('YXX_MEDIA_INPUT_INVALID');
    source=await readFile(input);output=await compressH5Image(source,mime,Number(limit));await writeFile(target,output,{flag:'wx',mode:0o600});
  }catch(error){
    const code=error instanceof Error&&/^YXX_MEDIA_[A-Z_]{1,80}$/u.test(error.message)?error.message:'YXX_MEDIA_IMAGE_CONVERSION_FAILED';
    process.stdout.write(JSON.stringify({error_code:code}));process.exitCode=1;
  }finally{source?.fill(0);output?.fill(0);}
}
