import {lazy,Suspense}from 'react';
import {useTranslation}from 'react-i18next';
import {ApiError}from '../api/client';
import type{useCommand}from '../hooks/useCommand';
import{Icon}from './Icon';
import{Alert,AlertTitle,AlertDescription,Button,Empty,EmptyHeader,EmptyMedia,EmptyTitle,EmptyDescription}from './ui/primitives';
export {Loading,SelfCheck} from './AppShell';
export function ErrorPanel({error,retry}:{error:unknown;retry?:()=>void}){const{t}=useTranslation();const auth=error instanceof ApiError&&[401,403].includes(error.status);return <Alert variant="destructive"><AlertTitle>{t(auth?'authRequired':'readFailure')}</AlertTitle><AlertDescription><p>{t(error instanceof ApiError&&error.status===503?'notAvailable':'networkError')}</p>{retry&&!auth&&<Button variant="outline" size="sm" onClick={retry}>{t('retry')}</Button>}</AlertDescription></Alert>;}
const CommandNotice=lazy(()=>import('./CommandNotice'));
export function RecoveryNotice(props:{command:ReturnType<typeof useCommand>;onRefresh?:()=>Promise<unknown>}){const {command}=props;if(command.status==='idle'||command.status==='pending'||command.status==='committed'&&!command.syncError)return null;return <Suspense fallback={null}><CommandNotice {...props}/></Suspense>;}
export function EmptyReports({query=false}:{query?:boolean}){const{t}=useTranslation();return <Empty className="empty-reports"><EmptyHeader><EmptyMedia><Icon name={query?'search':'task_alt'}/></EmptyMedia><EmptyTitle>{t(query?'queryEmpty':'emptyHistory')}</EmptyTitle><EmptyDescription>{t(query?'queryEmptyHint':'emptyDescription')}</EmptyDescription></EmptyHeader></Empty>;}
