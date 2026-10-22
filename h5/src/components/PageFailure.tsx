import {useTranslation} from "../i18n-react";
import {ErrorPanel} from './Common';
import {Alert,AlertTitle,Button} from './ui/primitives';
import {hasProtectedInput,reloadIfSafe} from '../lib/reload';
import type {PageRuntime} from '../page-runtime';

export default function PageFailure({error,runtime}:{error:unknown;runtime:PageRuntime}){
 const {t}=useTranslation();
 const asset=error instanceof Error&&/dynamically imported module|loading chunk|preload CSS/i.test(error.message),protectedDraft=hasProtectedInput();
 return <><ErrorPanel error={error} retry={()=>void runtime.refresh().catch(()=>undefined)}/>{asset&&<Alert><AlertTitle>{t('notAvailable')}</AlertTitle>{protectedDraft&&<p>{t('preserveDraft')}</p>}<Button variant="outline" disabled={protectedDraft} onClick={reloadIfSafe}>{t('refresh')}</Button></Alert>}</>;
}
