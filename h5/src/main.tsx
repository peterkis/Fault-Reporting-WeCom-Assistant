import{Component,type ErrorInfo,type ReactNode}from'react';
import{createRoot}from'react-dom/client';
import{QueryClient,QueryClientProvider}from'@tanstack/react-query';

import App from'./App';
import i18n from'./i18n';
import'./styles.css';
class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 componentDidCatch(_error:Error,_info:ErrorInfo){/* Sensitive server data is never logged. */}
 render(){return this.state.failed?<div className="standalone-state" role="alert"><p>{i18n.t('notAvailable')}</p><button className="ui-button ui-button-primary" onClick={()=>location.reload()}>{i18n.t('refresh')}</button></div>:this.props.children;}
}
async function start(){
 if(import.meta.env.DEV&&new URLSearchParams(location.search).get('preview')==='1'){const{installPreview}=await import('./dev/preview');await installPreview();}
 const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:true,refetchOnReconnect:true,gcTime:5*60_000},mutations:{retry:false,networkMode:'always'}}});
 const root=document.getElementById('root');if(!root)throw new Error('Missing H5 root');
 createRoot(root).render(<ErrorBoundary><QueryClientProvider client={client}><App/></QueryClientProvider></ErrorBoundary>);
}
void start();
