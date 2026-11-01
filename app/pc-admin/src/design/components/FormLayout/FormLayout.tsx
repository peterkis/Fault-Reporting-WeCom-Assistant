import type {ComponentProps,HTMLAttributes} from 'react';
import {Form} from '@heroui/react';
import './form-layout.css';

export function FormLayout({className='',...props}:ComponentProps<typeof Form>){return <Form {...props} className={'ds-form '+className}/>;}
export function FormActions({className='',...props}:HTMLAttributes<HTMLDivElement>){return <div {...props} className={'ds-form-actions '+className}/>;}
