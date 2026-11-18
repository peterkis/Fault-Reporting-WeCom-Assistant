# Card 35B 稳定性调查（重验）

原交付的背景与文字遮罩不足以证明稳定性，本轮全部移除。原失败、原有遮罩结果与旧输入指纹保留；本文件描述重新调查的范围。[原始探针摘要](stability-investigation.json)。

## 反馈与观测

诊断命令位于本地 `.build/visual/debug/rework/probe.mjs`，运行真实 fixture、HTTP/PG 和系统 Chrome，每次新建浏览器上下文及自有数据库。使用原始 RGBA 比较，不用 pixelmatch 阈值掩盖噪声。探针输出与 PNG 保存在明确标记的 `.build/visual/debug/rework/`，日志在本证据目录的 `logs/rework-*.log`。

| 探针 | 次数 | 对首张的原始差异像素 | 结论 |
| --- | ---: | --- | --- |
| 默认看板，去掉遮罩的控制组 | 8 | 0,291,291,0,0,291,291,0 | 成功复现排序文字波动 |
| 全局 text-rendering:optimizeSpeed | 8 | 见 JSON | 仍出现 291；不采用 |
| 清除所有恒等 transform | 8 | 0,51,51,51,51,51,51,51 | 排序噪声消失，但其他筛选文字产生新差异；不采用 |
| 全局恒等 transform + 内联 will-change:auto | 8 | 见 JSON | 仍有筛选文字差异；不采用全局 transform 清除 |
| 仅清除排序按钮的恒等 transform | 8 | 全 0 | 保留文字、字体、按钮轮廓与箭头；采用 |
| 无遮罩抽屉控制组（额外绘制等待） | 8 | 全 0 | 本次未复现原背景失败，不能写成稳定性修复证明 |
| 无遮罩抽屉，内联清除残留 will-change | 12 | 全 0 | 采用后再接受完整五轮验证；不单凭此探针宣布背景原因已完全证实 |

字体控制组八次均使用自定义 Noto Sans SC（PostScript 名 `NotoSansSC-Thin_Medium`，四个字形），不是随机切换到 PingFang。排序按钮位置均为 x=533.328125、y=225、92×26；字体与几何一致，但带 `scale(1)` 的恒等 transform 会建立额外绘制边界。只移除该恒等变换后，291 像素波动不再出现。没有换字体、改字号或把坐标取整。

抽屉观测中 `document.getAnimations()` 为空，抽屉的视口和 clientWidth 都为 1440，看板 clientWidth 固定为 1432，没有滚动条宽度抖动；图片已加载。实际 backdrop-filter 为 none；灰度 filter 仅来自产品既有的已关闭类别图标，未移除它。没有通过关闭 scrim、隐藏背景或关闭真实 filter 取稳定。

原全局 `*{will-change:auto!important}` 没有压过 HeroUI 的分层 important 规则：实际抽屉仍是 `will-change:translate`，disclosure 仍为 `height, opacity`。修正为生命周期结束后内联设置 auto，再等待绘制。该修改消除残留合成提示，保持产品几何与内容。对原背景边缘现象的合成层解释仍属于有观测依据的推断；最终依据是完整 18 屏五轮无遮罩、全部配对原始像素结果，不能从控制组偶然通过反推唯一原因。

## 剩余差异与部分栅格复用

仅做上述 hint/恒等变换处理后，构建输入 `3aa8a678070ed2730f277e5aecddf1319894300cb2c23de55b9fd01bf75002c4` 的预检与源码恢复后捕获仍有两处原始差异：`drawer-dismissed` 背景搜索/筛选文字 49 像素（最大通道差 19），`close-dialog-duplicate` 背后徽标 6 像素（最大通道差 1）。此时没有宣布稳定性通过。[对照回执](restored-preflight-raw.json)。

新增一次只改变 Chrome 启动参数的探针：禁用部分栅格复用。`drawer-dismissed` 与 `close-dialog-duplicate` 各十二次直接 capture（没有额外探针 settle）全部为 0。开关含义从 [Chromium 源码](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/common/switches.cc)核验；它禁用 renderer 的 partial raster。测试中的前后变化支持绘制复用与小差异有关，不能据此断言浏览器内部只有一个原因。

最终将 `fullRaster` 作为已有 browser harness 的显式测试参数，仅 visual capture 传入 true。该参数加入 `--disable-partial-raster`，其他浏览器测试默认参数与既有断言保持。没有修改产品代码、没有关闭透明 scrim、没有对 PNG 做降色或像素容差处理。修正前的源码反向验证回执另存 `pre-full-raster-*`，最终重新执行源码实验。

## 几何复查修正

输入 `2b43b2e6c96ada9ea026df50bfb88848f31ad2acc68d7e4578dcfa05a3f220f1` 虽通过了五轮原始像素比较，图像复查仍发现：清掉抽屉的 `will-change:translate` 会改变 fixed 元素的包含块，让提示栈偏移约 8px。该候选没有作为最终交付；其记录保留为 `pre-geometry-guard-*`。

最终保留会建立包含块的提示（transform/translate/scale/rotate/perspective/filter/contain），仅清理其他提示；排序控件仍只移除恒等变换。每次稳定化调用在 `waitForAnimationsSettled` 后记录排序按钮、抽屉和所有提示的矩形，处理后逐项检查坐标、宽高完全相等，发生移动即失败。没有改产品定位代码，也没有放宽原几何断言。

## 采用的稳定化

- 等待在途业务请求、可见文字字体、`document.fonts.ready` 和真实图片 decode。
- 等进入/退出状态及 `waitForAnimationsSettled` 完成后，只清理不建立固定定位包含块的 will-change；保留抽屉的 translate 提示。
- 只清除 `.ds-column-sort` 上的恒等 transform，不改非恒等变换。
- 在 visual capture 的浏览器进程中禁用部分栅格复用，等两帧并完成一次绘制再捕获；清单的 18 个 mask 都为空。
- 不为稳定性保留产品源码改动；不改变几何或业务断言。

完整结果由 [五轮表格](stability.md) 和 [最终交付](README.md) 绑定最终输入指纹。诊断探针属于前一构建上的对照实验，不冒充最终候选的全量验收。
