import {interactions} from './loader';
import {motionAllowed} from '../experience';
export function UploadProgress({value,label}:{value:number;label:string}){
 const kit=interactions.use();
 return kit&&motionAllowed()?<kit.UploadProgress value={value} label={label}/>:<progress max={100} value={value} aria-label={label}/>;
}
