import type {ReactNode} from 'react';
import {TooltipAnchor} from '../Tooltip/Tooltip';
import './kbd.css';

export interface KbdProps {
  keys: readonly string[];
  tone?: 'light' | 'dark' | undefined;
  separator?: string | undefined;
  disabled?: boolean | undefined;
  decorative?: boolean | undefined;
  className?: string | undefined;
}

export function Kbd({
  keys,
  tone = 'light',
  separator,
  disabled = false,
  decorative = true,
  className = '',
}: KbdProps) {
  return (
    <span
      className={'ds-kbd-group' + (className ? ' ' + className : '')}
      data-tone={tone}
      data-disabled={disabled ? 'true' : undefined}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {keys.map((token, index) => (
        <span key={`${index}:${token}`} className="ds-kbd-entry">
          {index > 0 && separator ? <span className="ds-kbd-sep">{separator}</span> : null}
          <kbd className="ds-kbd" data-tone={tone}>
            {token}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export interface ShortcutTooltipProps {
  label: string;
  keys: readonly string[];
  separator?: string | undefined;
  placement?: 'top' | 'bottom' | 'top-end' | 'bottom-end' | 'bottom-start' | undefined;
  className?: string | undefined;
  enabled?: boolean | undefined;
  children: ReactNode;
}

export function ShortcutTooltip({
  label,
  keys,
  separator,
  placement = 'top',
  className = '',
  enabled = true,
  children,
}: ShortcutTooltipProps) {
  return (
    <TooltipAnchor
      className={
        'ds-shortcut-tooltip-anchor ds-shortcut-tooltip-' +
        placement +
        (className ? ' ' + className : '')
      }
    >
      {children}
      {enabled && keys.length > 0 ? (
        <span className="ds-shortcut-tooltip" role="tooltip" data-shortcut-tooltip="true">
          <span>{label}</span>
          <Kbd keys={keys} tone="dark" {...(separator ? {separator} : {})} />
        </span>
      ) : null}
    </TooltipAnchor>
  );
}
