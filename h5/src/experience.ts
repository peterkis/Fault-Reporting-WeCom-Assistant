/** Document-scoped evaluation only. Invalid/absent values preserve the baseline. */
export function parseExperienceMode(search:string,fallback:'baseline'|'static'|'animated'='baseline'):'baseline'|'static'|'animated'{
 const value=new URLSearchParams(search).get('ui');
 return value==='baseline'||value==='static'||value==='animated'?value:fallback;
}
export const experienceMode=parseExperienceMode(typeof location==='undefined'?'':location.search,typeof __H5_UI_EVALUATION__==='undefined'?'baseline':__H5_UI_EVALUATION__);
export const newExperience=experienceMode!=='baseline';
export function motionAllowed(){return experienceMode==='animated'&&typeof matchMedia==='function'&&typeof matchMedia('(prefers-reduced-motion: reduce)').addEventListener==='function'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;}
export function prepareInteractions(){if(motionAllowed())void import('./enhancements/loader').then(module=>module.interactions.load()).catch(()=>{});}
