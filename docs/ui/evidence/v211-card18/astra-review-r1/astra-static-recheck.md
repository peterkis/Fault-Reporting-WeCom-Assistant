# 第二轮：第一批修补的有界静态复查

范围：root获得三个精确Drawer颜色Token授权后的未提交修补。未构建、未运行测试、未渲染原型；实际截图稍后独立复查。源码由root持续写入，本报告绑定读取时内容，不能替代最终候选审核。

已确认：

- EXTERNAL 标签已恢复“报修人可见”，不再把可见性称为投递成功。
- `ActivityRecord` 的 bubble 分支使用头行+正文；`time`在bubble头行和非bubble尾列之间二选一，没有同一记录重复时间。
- `PersonalReadMaterial`仅保留一处，正文没有为版式复制；原sourceRef/revision、active、principal、item与文字观察节点仍在。点击展开的状态与钩子保持。
- composer 的 `::before` 仅位于第一列跨前两行，pointer-events:none，label/textarea z-index1；保存按钮在第二列，移动端明确第三行。绝对定位的sr-only受众说明不占网格。CSS没有移动提交节点或重写事件。
- NextStep只新增展示data-status、等待图标和辅助文案class；orders、StepEntry注册/portal、权限及命令语义未变。
- 全局tokens只追加获批的三色，局部尺寸变量通过既有Token组合；规范已先追加对应说明。
- 描述容器border:0和页签20px覆写明确，字号/圆角/正文颜色修补范围正确。

构建前应修的级联问题：

1. Timeline局部行选择器 `.ds-detail .ds-timeline .detail-record` 与通用 `.ds-timeline .ds-timeline-item.detail-record` 同为0,3,0；::before两条也同权重。现有打包CSS顺序为Drawer在前、Timeline在后，因此通用20px列/gap8/padding12与线轨位置会覆盖新的局部规则，而头像22px会生效。建议局部行与::before选择器补 `.ds-timeline-item`，使其不依赖导入先后。这是静态级联推断；待新制品截图确认。
2. 顶栏原横线由detail-content.css的 `box-shadow:inset 0 -1px 0 var(--border-hair)`绘制。新规则仅border-bottom-color不会改变它；应直接改shadow所用色，或明确border-bottom并消除旧shadow。
3. 等待卡原型是inset 1px shadow，新规则使用border1会增加自动高度2px并消耗内宽。若追求同一几何，应改border0 + inset shadow。

低优先级精细差异：等待clock原型18px/实现20px，英雄类别图标原型22px/实现20px，状态/event行高原型22px/通用规则20px。均可局部组合现有Token；不是业务正确性问题。

待root修补后，只需检查上述选择器和新截图，无需重新扩张全套测试范围。
