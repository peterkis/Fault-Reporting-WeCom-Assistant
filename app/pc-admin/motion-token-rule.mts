import stylelint from 'stylelint';

export const ruleName='design/motion-tokens';
const messages=stylelint.utils.ruleMessages(ruleName,{rejected:'Motion duration/delay and easing must use design tokens (or none / 0s).'});
/** Login decorations are the sole path exemption, configured explicitly in .stylelintrc.json. */
const rule:stylelint.Rule=()=> (root,result)=>{
  root.walkDecls(/^(?:transition|animation)(?:-|$)/,decl=>{
    if(decl.value==='none')return;
    const invalid=decl.value.split(/,(?![^()]*\))/).some(value=>{
    const tokens=[...value.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(match=>match[1]??'');
    const stripped=value.replace(/var\([^)]*\)/g,'TOKEN');
    const bareTime=[...stripped.matchAll(/(?:^|[^\w.-])(-?(?:\d*\.)?\d+)(ms|s)\b/g)].some(match=>match[1]!=='0'||match[2]!=='s');
    const bareCurve=/(?:\b(?:ease(?:-in-out|-in|-out)?|linear|step-start|step-end)\b|(?:cubic-bezier|steps)\s*\()/.test(stripped);
    const shorthand=decl.prop==='animation'||decl.prop==='transition';
    const stateLoop=decl.source?.input.file?.replaceAll('\\','/').endsWith('/design/components/Skeleton/skeleton.css')&&/^\s*(?:ds-skeleton-pulse|ds-refresh-progress)\b/.test(value);
    const duration=tokens.some(token=>token.startsWith('--dur-')||stateLoop&&token==='--load-pulse');
    const curve=tokens.some(token=>token.startsWith('--ease-'));
    const zero=/\b0s\b/.test(stripped),delay=tokens.some(token=>token.startsWith('--delay-'));
    return bareTime||bareCurve||shorthand&&(!duration&&!zero||!curve&&!zero)||decl.prop.endsWith('-duration')&&!duration&&!zero||decl.prop.endsWith('-timing-function')&&!curve||decl.prop.endsWith('-delay')&&!duration&&!delay&&!zero;
    });
    if(invalid){
      stylelint.utils.report({message:messages.rejected,node:decl,result,ruleName});
    }
  });
};
rule.ruleName=ruleName;rule.messages=messages;
export default stylelint.createPlugin(ruleName,rule);
