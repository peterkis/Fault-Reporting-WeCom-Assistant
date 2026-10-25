import {Component,type ReactNode} from 'react';
import {useTranslation} from "../i18n-react";
import {Alert,AlertTitle,AlertDescription,Button} from './ui/primitives';
import {hasProtectedInput,reloadIfSafe} from '../lib/reload';
function PanelFailure({onClose}:{onClose:()=>void}){const{t}=useTranslation(),protectedInput=hasProtectedInput();return <Alert variant="destructive"><AlertTitle>{t('notAvailable')}</AlertTitle><AlertDescription>{protectedInput&&<p>{t('preserveDraft')}</p>}<Button variant="outline" onClick={onClose}>{t('close')}</Button><Button variant="outline" disabled={protectedInput} onClick={reloadIfSafe}>{t('refresh')}</Button></AlertDescription></Alert>;}
/** A failed optional chunk must not unmount the draft or pending command scope. */
export class LazyPanelBoundary extends Component<{children:ReactNode;onClose:()=>void},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<PanelFailure onClose={this.props.onClose}/>:this.props.children;}
}
