import brandLogo from '../assets/yixiaoxiu-logo.svg';
import './sidebar-brand.css';

export function SidebarBrand({team}:{team:string}){
 return <div className="sidebar-brand"><img className="sidebar-brand-icon" src={brandLogo} alt=""/><div className="sidebar-brand-copy"><strong>医小修</strong><span data-sidebar-team>{team}</span></div></div>;
}
