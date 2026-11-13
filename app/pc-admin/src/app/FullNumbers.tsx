import {useState} from 'react';
import {Button as HButton} from '../design/components/Button/Button';

/**
 * Codex review (card 34C): lists that name items by a short code (「会话尾号」「订阅尾号」) can show the full numbers on request, for
 * keyboard and touch users who cannot hover. Nothing technical is shown until the button is pressed.
 */
export function useFullNumbers(){
  const [shown,setShown]=useState(false);
  const toggle=<HButton type="button" data-action="toggle-full-numbers" aria-pressed={shown} tone="ghost" onClick={()=>setShown(value=>!value)}>{shown?'隐藏完整编号':'显示完整编号'}</HButton>;
  return {shown,toggle};
}
