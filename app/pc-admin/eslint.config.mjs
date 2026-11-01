import parser from '@typescript-eslint/parser';

export default [{
  files: ['src/features/**/*.{ts,tsx}'],
  languageOptions: {parser, parserOptions: {ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: {jsx: true}}},
  rules: {
    'no-restricted-syntax': ['error',
      {selector: 'JSXOpeningElement > JSXAttribute[name.name="variant"]', message: '功能层使用 design/components/Button 的 tone，不直接设置 HeroUI variant。'},
      {selector: 'JSXAttribute[name.name="style"]', message: '视觉样式使用语义 Token 和组件 CSS，不在功能 JSX 中写内联样式。'},
      {selector: 'JSXAttribute[name.name="className"] :matches(Literal[value=/status-chip/], TemplateElement[value.raw=/status-chip/])', message: 'status-chip 仅在设计组件内保留为测试语义钩子，功能层通过 tone 表达状态。'},
      {selector: 'ImportDeclaration[source.value=/^@heroui\\u002Freact/] ImportSpecifier[imported.name="Button"]', message: '功能层只组合 design/components/Button，禁止直接导入 HeroUI Button（包括别名）。'},
    ],
  },
}];
