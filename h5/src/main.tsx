import{Component,type ErrorInfo,type ReactNode}from'react';
import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';

import App from'./App';
import{PageRuntime}from'./page-runtime';
import i18n from'./i18n';
import{I18nProvider}from'./i18n-react';
import{hasProtectedInput,reloadIfSafe}from'./lib/reload';
import'./styles.css';
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(_error:Error,_info:ErrorInfo){/* Sensitive server data is never logged. */}
 render(){const protectedDraft=hasProtectedInput();return this.state.failed?<div className="standalone-state" role="alert"><p>{i18n.t('notAvailable')}</p>{protectedDraft&&<p>{i18n.t('preserveDraft')}</p>}<button className="ui-button ui-button-primary" disabled={protectedDraft} onClick={reloadIfSafe}>{i18n.t('refresh')}</button></div>:this.props.children;}
}
async function start(){
 if(import.meta.env.DEV&&new URLSearchParams(location.search).get('preview')==='1'){const{installPreview}=await import('./dev/preview');await installPreview();}
 const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,refetchOnReconnect:false,refetchOnMount:false,staleTime:30_000,gcTime:2*60_000},mutations:{retry:false,networkMode:'always'}}});
 const runtime=new PageRuntime(client);runtime.start();
 const root=document.getElementById('root');if(!root)throw new Error('Missing H5 root');
 createRoot(root).render(<ErrorBoundary><I18nProvider><QueryClientProvider client={client}><App runtime={runtime}/></QueryClientProvider></I18nProvider></ErrorBoundary>);
 if(import.meta.hot)import.meta.hot.dispose(()=>{runtime.stop();void client.cancelQueries();client.clear();});
}
void start();
