---
title: 更新内容
description: "用增量更新发布文档仓库的新提交。"
---

# 更新内容

一次构建是所有文档仓库的快照。当 GitHub 来源的仓库有新提交时，**增量更新**
负责发布它们：只重新渲染有变更的仓库，其它页面沿用上一次构建的结果。

::: tip 本地仓库
本地仓库位于本仓库中，所以它们的修改随应用的部署（推送到 `main`）发布，
而不是随更新发布。
:::

## 原理

```bash
bun run update
```

1. 读取上一次构建留下的 `dist/state.json`：构建所基于的提交，以及每个仓库的
   提交和它渲染出的页面。
2. 向 GitHub 查询每个仓库当前的提交（`git ls-remote`，不需要克隆）。
3. 对每个提交有变动的仓库：拉取它，删除它旧的页面、搜索索引和 Vue 组件，
   然后重新渲染。
4. 重写 `sitemap.xml` 和状态文件。

未变更的仓库既不拉取也不渲染，所以没有变化时一次更新只需几秒。之所以重新渲染
整个仓库而不是单个页面，是因为页面还依赖于所在仓库的侧边栏、相邻页面、include
和仓库配置。

失败的仓库（分支已不存在、某个页面渲染时出错）会保留原有的页面，下一次更新会
再试。其它仓库照常更新，`bun run update` 以错误退出，所以工作流会先部署它们，
再把这次运行标记为失败。

如果没有上一次构建，或者它基于本仓库的另一个提交（应用、配置或本地文档有变更），
只有完整构建才是正确的，此时 `bun run update` 会执行完整构建。

然后照常部署：`bunx wrangler deploy` 只上传有变化的文件。

## Update content 工作流

`.github/workflows/update-content.yml` 在 GitHub Actions 中运行更新，并在有变更时
部署：

- **每小时**一次，文档仓库无需任何设置，新提交就会在一小时内上线。
- **收到 `repository_dispatch`**（类型为 `update-content`）时，这样文档仓库可以在
  推送后立即发布（见下文）。
- **手动运行**，在 Actions 标签页中触发。

它从 Actions 缓存中恢复上一次构建（由 **Deploy** 工作流或它自己上一次运行留下），
并检出该构建所基于的本仓库提交，因此不会发布没有经过 Deploy 的应用改动。
没有缓存的构建时（缓存已被清除），它会对 `main` 执行一次完整构建。

## 推送时发布

要让文档仓库的提交立即发布，在该仓库中加入这个工作流：

```yaml
# 文档仓库中的 .github/workflows/vellum.yml
name: Publish docs
on:
  push:
    branches: [main]
    paths: ["docs/**"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: gh api repos/siiway/vellum/dispatches -f event_type=update-content
        env:
          GH_TOKEN: ${{ secrets.VELLUM_DISPATCH_TOKEN }}
```

`VELLUM_DISPATCH_TOKEN` 是文档仓库中的一个 secret：一个对 Vellum 仓库具有
**Contents: Read and write** 权限的细粒度令牌（`repository_dispatch` 需要这个
权限）。把 `paths` 改成该仓库的 `docsRoot`。

连续多次推送没有问题：在另一次运行进行中开始的运行会等待它结束，没有发现新内容的运行不会部署。

## 故障排查

::: details 新提交没有出现在站点上
查看最近一次 **Update content** 运行。它的日志会列出重新渲染的仓库，或者说明
没有变化。如果仓库没有被列出，确认该提交位于 `vellum.config.json` 中配置的分支
（或 `versions` 的默认项）上。
:::

::: details 我想重新构建所有内容
手动运行 **Deploy** 工作流。它会从头构建每个页面，下一次更新也会以它的构建为
起点。
:::
