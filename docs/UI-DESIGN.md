# 栖台界面设计

本版按用户确认的 A 方案改造现有 React/Vite 工作台，默认深色，界面语言为简体中文。

## 设计参考与实现

参考项目：[ShadcnStore dashboard and landing template](https://github.com/shadcnstore/shadcn-dashboard-landing-template)，参考版本 `953300fa5176608a9d682943edfc359ce809f2c7`，2026-10-09 核对官方 Vite 版本的主题、布局与仪表盘组织。采用其克制的中性色、细边框、侧栏与内嵌工作区的设计方向。保留现有组件与业务实现，未引入该模板的运行时、依赖、字体或远程图片。下列 MIT 声明保留上游来源信息。

## 视觉规则

- 深色背景 `#09090b`、侧栏 `#101012`、卡片 `#141416`、边框 `#2b2b30`；浅色由同一组 CSS 变量完整切换。
- 正文以 13–14px 为主，说明 12px，标题 25–28px，额度数字 36–38px；细小的 10–11px 仅用于徽标、导航辅助信息等次级内容。
- 强调色只用于主要操作、进度和状态。深色主要按钮以 `#181726` 文字搭配 `#a2a1ff` 底色，浅色以白字搭配 `#5656d6`。
- 总览先呈现今日任务与计划，再展示额度和学习指标。图表、记录及空态沿用真实数据来源，合成演示模式保留明确标记。
- 不同功能页沿用相同卡片、表单、表格、确认框与 AI 输入组件。横向表格只在局部容器中滚动。

## 主题与导航

`src/lib/theme.ts` 在 React 首次渲染之前初始化，沿用 `workbench-theme` 键；只接受 `light` / `dark`，无偏好或无效值默认深色。读写存储分别捕获失败，仍应用根元素类、color-scheme 与 theme-color。登录页面与应用内均可切换主题，切换按钮初值以当前 DOM 主题为准，避免存储不可写时跨页面状态失配。

桌面侧栏可收起成图标栏，每个导航保留可访问名称、悬浮提示与当前页语义。767px 及以下使用现有 Radix Dialog 实现抽屉，支持焦点约束、Escape / 遮罩关闭、选择页面后关闭并返回触发按钮。手机按钮和主要表单控件的操作目标至少 44px。支持键盘跳转到主要内容，尊重减少动态效果偏好。

`src/styles.css` 管理主题变量和基础控件；`src/workbench.css` 管理共享组件、页面布局与响应式规则，替代旧样式块。主题行为测试位于 `src/lib/theme.test.ts`。桌面/手机截图与功能交互由本次发布控制流程验收；演示截图属于合成数据，不证明云端业务记录。

## 业务边界

保持 useWorkbench 状态、认证请求、保存/删除处理器、任务导入、AI 流式读取和终止、咨询授权确认、人工审核、密钥保存/清除及备份恢复语义。产品名、模型标识、API、JSON、币种代码和用户输入保留原文；词元单位与应用说明使用中文。

## 上游许可

```text
MIT License

Copyright (c) 2025 ShadcnStore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
