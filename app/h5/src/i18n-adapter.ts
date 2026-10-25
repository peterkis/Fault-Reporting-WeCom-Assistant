import {setupI18n,type I18n,type Messages,type Values} from '@lingui/core';
import {clientLanguage} from './lib/preferences';

export type Language='en'|'zh-CN';
export type TranslationOptions=Values&{lng?:string};
type Translator=(id:string,values?:Values)=>string;

/** Official compiled catalogs and formatters; this only preserves the H5 API. */
export function createI18nAdapter(messages:Record<Language,Messages>,language:Language){
 const instance=setupI18n({locale:language,messages}),english=setupI18n({locale:'en',messages:{en:messages.en}});let explicit:I18n|undefined;
 function translate(active:Translator,namespace:string,key:string,options?:TranslationOptions):string{
  const{lng,...values}=options??{},locale=lng===undefined?instance.locale:clientLanguage('',lng),id=key.includes(':')?key:namespace+':'+key;
  let reader=instance;if(locale!==instance.locale)reader=locale==='en'?english:(explicit??=setupI18n({locale:'zh-CN',messages}));
  if(Object.hasOwn(reader.messages,id))return(reader===instance?active:reader.t)(id,values);
  if(Object.hasOwn(english.messages,id))return english.t(id,values);
  return key.includes(':')?key.slice(key.indexOf(':')+1):key;
 }
 const i18n={
  get language():Language{return instance.locale==='zh-CN'?'zh-CN':'en';},
  changeLanguage(next:string):Promise<void>{instance.activate(clientLanguage('',next));return Promise.resolve();},
  t(key:string,values?:TranslationOptions):string{return translate(instance.t,'translation',key,values);},
  addResourceBundle(locale:string,namespace:string,catalog:Messages):void{
   const language=clientLanguage('',locale),qualified=Object.fromEntries(Object.entries(catalog).map(([key,value])=>[key.includes(':')?key:namespace+':'+key,value]));
   instance.load(language,qualified);if(language==='en')english.load('en',qualified);explicit?.load(language,qualified);
  }
 };
 return{instance,i18n,translate};
}
