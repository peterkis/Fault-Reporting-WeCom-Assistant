import {Wrench} from 'lucide-react';
import './sidebar-brand.css';

export function SidebarBrand({team}:{team:string}){
 return <div className="sidebar-brand"><span className="sidebar-brand-icon" aria-hidden="true"><Wrench/></span><div className="sidebar-brand-copy"><strong>医小修</strong><span data-sidebar-team>{team}</span></div></div>;
}
