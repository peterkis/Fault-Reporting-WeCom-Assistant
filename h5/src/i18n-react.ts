import {I18nProvider as LinguiProvider,useLingui} from '@lingui/react';
import {createElement,useCallback,type ReactNode} from 'react';
import i18n,{instance,translate} from './i18n';
import type {TranslationOptions} from './i18n-adapter';

export function I18nProvider({children}:{children:ReactNode}){return createElement(LinguiProvider,{i18n:instance},children);}
export function useTranslation(namespace='translation'){
 const{_}=useLingui();
 const t=useCallback((key:string,values?:TranslationOptions)=>translate(_,namespace,key,values),[_,namespace]);
 return{t,i18n};
}
