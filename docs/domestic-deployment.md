# 国内访问优先的部署方案

当前采用 Sealos 杭州短期演示，公网完整浏览器/API/重启持久化已验证。入口与有效期见 [交付记录](delivery.md)，可复现清单及自动清理说明见 [短期部署](sealos-short-demo.md)。网站业务不调用海外字体、CDN、Supabase 或 Vercel；GitHub 用于原题要求的源码与 CI，首次拉取镜像仍使用 GHCR。

此前核实腾讯云 CloudBase 免费 PostgreSQL 共享实例不提供 Prisma 所需直连，所以没有升级数据库，而是使用 Sealos 内独立 PostgreSQL。仅使用现有体验余额，不称为永久免费。

下面是后续迁移的备用架构，当前没有购买服务器。

## 备用方案：自有服务器

一台国内云厂商的 Linux x86_64 服务器，以及用于 HTTPS 的域名。初始演示配置建议 2 核 4 GB、40 GB 以上系统盘、Ubuntu 24.04 LTS；这是低流量演示的起点，不是经过压测的容量承诺。腾讯云轻量应用服务器或阿里云 ECS 均可；先选一家，不同时接入多家。

- 已有符合接入要求的备案域名：可选中国大陆地域。
- 没有备案且需要短期演示：可考虑同一国内云厂商的中国香港地域；香港不属于中国大陆地域，不能写成“所有数据位于大陆”。
- 腾讯云明确说明，中国内地地域对外提供网站/APP 服务需备案，见[官方使用限制](https://cloud.tencent.com/document/product/1207/44376)。域名、备案和证书条件须在实际选购时确认，不能绕过这些条件承诺当天上线。
- 不在本文虚构优惠价。购买前提供控制台真实配置、地域、首期总价、续费价和是否自动续费，由用户确认后购买。

只对公网开放 80/443；SSH 限管理来源。PostgreSQL 没有宿主机端口映射，应用 3000 端口也只在 Docker 内网使用。Caddy 负责 HTTPS 并反代到 Next.js，浏览器始终同源请求 API。生产 cookie 保留 Secure；不能为使用裸 HTTP 而关闭它。

## 部署文件

- `Dockerfile`：Node 22、独立迁移镜像、生产应用镜像；应用以非 root 用户运行。
- `compose.production.yaml`：真实 PostgreSQL、先迁移后启动应用、持久化数据库卷、健康检查、有限日志轮转。
- `deploy/Caddyfile`：公开入口与 HTTPS。只在 `--profile public` 下启动。
- `.dockerignore`：排除本地环境文件、会话 token、数据库数据和测试输出，禁止将本地密钥打入镜像。
- `deploy/environment.example`：私有 `.env.deploy` 的模板。
- `tests/deployment/smoke.mjs` 与 `Container deployment` CI：在实际生产镜像中运行填写/恢复/鉴权/并发支付，再销毁并重建容器，验证数据与幂等记录仍存在。此处不删除数据库卷。

## 避免服务器依赖海外下载

优先在 CI 构建并验证 Linux amd64 镜像，然后导出到本机，经 SSH/SCP 上传国内服务器。服务器用 `docker load` 导入，启动时加 `--no-build --pull never`。应用、迁移工具、PostgreSQL、Caddy 都包含在导出包里；服务器不需要从 GitHub 拉源码，也不需要运行 npm install。

从 GitHub Actions 手动运行 `Container deployment`，勾选 `export_images`。仅在容器验收成功后导出 `qinghe-offline-images` artifact，含 `qinghe-linux-amd64.tar.gz` 与 `SHA256SUMS`，保留 7 天。也可由维护者在已安装 Docker 的 Linux amd64 构建机运行同样流程。归档不是数据库备份，不包含业务数据或部署密码。

若使用国内镜像仓库，应把已验证镜像推送到自己账号的腾讯云 TCR/阿里云 ACR，再修改 APP_IMAGE 等变量。不要依赖随意搜到的匿名镜像代理。阿里云官方也说明镜像加速器有适用限制，见[镜像加速说明](https://help.aliyun.com/zh/acr/user-guide/accelerate-the-pulls-of-docker-official-images)。

## 首次安装（服务器 Bash）

前置条件：Docker Engine 和 Compose v2 已安装；域名 A 记录指向该服务器；若配置 AAAA，IPv6 也必须实际可达；80/443 可访问；对应地域备案要求满足。

把源码交付包中的 `compose.production.yaml`、`deploy/`，以及镜像归档上传到服务器同一目录。检查包完整性并导入：

```bash
sha256sum -c SHA256SUMS
gzip -dc qinghe-linux-amd64.tar.gz | docker load
umask 077
cp deploy/environment.example .env.deploy
# 编辑 .env.deploy：填写域名、完整 HTTPS APP_ORIGIN。
# POSTGRES_PASSWORD 使用 openssl rand -hex 32 生成的随机值。
# 不使用示例值，不公开这个文件，不把密码发到聊天或 Git。
chmod 600 .env.deploy
docker compose --env-file .env.deploy -f compose.production.yaml --profile public up -d --no-build --pull never --wait
docker compose --env-file .env.deploy -f compose.production.yaml ps
```

首次启动顺序为数据库健康 → `prisma migrate deploy` 三份迁移成功 → 应用健康 → HTTPS 入口。迁移失败会阻止应用启动。Docker 健康检查证明进程能响应，不能证明业务全流程正确；仍须执行下面的公网验收。

需要在线构建时，在源码根目录先执行 `docker compose --env-file .env.deploy -f compose.production.yaml build`，再启动。构建需要访问 npm、Prisma 二进制源及基础镜像/软件源；国内网络不稳定时应使用上述离线包，不把国内 npm registry 等同“所有构建依赖都已国产化”。

## 公网验收与交付

1. 从无登录状态浏览器打开 HTTPS 域名，填写到中途后刷新/关闭再打开，确认恢复。
2. 完成测评，检查免费接口只有 BMI、分类、付费提示；页面 HTML/响应也不得泄漏预测曲线。
3. 打开模拟付费弹窗，确认没有真实收费；`/pay` 后完整结果出现。
4. 使用 README 的完整 curl 流程建立两个虚构会话，保留 unpaid 与 paid 的 sessionId 和 cookie 到本地私有交付文件。重放相同 Idempotency-Key，paymentId/有效期不变。
5. 在当前用户电脑和独立网络检查页面/API 可达性。记录网络环境；不能把经过代理的访问当成中国大陆直连成功证据。
6. 重启服务后恢复相同会话、结果和订阅；测试跨用户隔离、非法输入和付费保护字段。
7. 更新 `docs/delivery.md`、最终交付文档与线上 curl 示例，填写实际 URL、paid sessionId、验证日期和 CI 链接。

## 数据备份与更新

在项目目录执行，备份文件应放到访问受限的目录并另外复制到安全位置：

```bash
umask 077
docker compose --env-file .env.deploy -f compose.production.yaml exec -T db pg_dump -U health -d health -Fc > health-backup.dump
```

镜像升级前备份数据库，导入新镜像，先执行 `docker compose --env-file .env.deploy -f compose.production.yaml run --rm migrate`，成功后 `up -d --no-build --pull never --wait`。数据库卷不会因普通 `down` 丢失；**线上禁止使用 `down --volumes`**。迁移失败时保留旧应用，检查迁移记录，不使用 reset。回滚应用需确认数据库结构兼容。

当前为单机演示部署，不宣称高可用；已完成本机公网验收，尚未做独立多地域网络与负载测试。真实支付、集群和复杂监控不属于原题必需项。
