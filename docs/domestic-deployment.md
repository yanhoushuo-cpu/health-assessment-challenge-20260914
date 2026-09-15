# 国内访问优先的部署方案

本方案替代此前的 Vercel + Supabase 托管方案。原题允许 Prisma + PostgreSQL，不强制 Supabase，也不强制 Vercel。保留 GitHub 源码与 CI，因为题目明确要求 GitHub 交付。网站运行不调用 GitHub、Vercel、Supabase 或海外字体/CDN。

当前状态（2026-09-15）：腾讯云上海免费体验环境 air 已创建，CLI 已授权；套餐为 baas_trial，状态 NORMAL，到期时间 2027-03-15 23:59:59，自动续费和超限付费均关闭。PostgreSQL 17.11 共享实例运行正常，但控制台确认共享集群不提供直连配置，现有 Prisma 后端因此尚不能部署到该数据库。未取得可演示业务的公网地址；Docker 配置或 CI 成功均不能代替公网验收。

## 已核验但受阻：CloudBase 免费体验环境

原计划使用同一个上海地域环境中的 PostgreSQL 与云托管，运行现有 Next.js + Prisma 应用。实际控制台中，内网地址为空，外网开启、密码重置和 SSL 配置均不可用；禁用按钮提示“当前共享集群暂不提供相关能力，可以升级至独享集群启用能力。”因此不能仅根据产品文档中的 PostgreSQL 支持说明，断言免费套餐可供 Prisma 直连。尚未写入业务表或部署应用，也没有升级付费套餐。

下一候选为 Sealos 杭州站的容器与 PostgreSQL 服务。其官网提供注册免费额度，但仍需登录核验实际额度、有效期和部署成本；未确认前不将其写成已采用或永久免费方案。保留原来的数据库迁移、服务端鉴权和测试，不改用静态网页或浏览器本地存储代替后端。

Sealos 实际核验补充：杭州账号已登录，余额 5.00，充值记录列表无订单。数据库表单中 PostgreSQL 16.4.0、0.5 核、512 MiB、3 GiB、1 个实例预估 0.56/天；应用、备份及流量还需单独核算。官方计费系统存在欠费状态，不能假设余额恰好为零就立即停机且不再计费。用户已明确接受短期演示，但最多使用现有 5 元且不能欠费。账号告警设置只提供通知方式，尚未找到消费硬上限；未点击部署。定时停止也不能直接等同预算硬上限，还须涵盖存储、备份和流量。不能把赠送额度说成无限免费托管。

- 开通入口：腾讯云 CloudBase 购买页，选择上海、免费体验版、PostgreSQL；费用必须为 0.00 元。页面要求关注公众号并输入“领取兑换码”，获得一次性兑换码后才能提交。
- [官方资源点说明](https://cloud.tencent.com/document/product/876/127357)：免费体验提供每月 3000 资源点，支持在到期前一个月内手动续期 6 个月，不支持自动续费；免费环境不支持加购资源包或开启按量付费。不将其描述为无限容量或永久免费。
- [默认域名说明](https://docs.cloudbase.net/service/introduce)：平台默认域名用于开发测试，有访问限制及访问提示中间页。必须实际验证匿名浏览器与 cURL 能完成测评、恢复和模拟支付，才能将 URL 列为交付成果。
- 待开通后核验：云托管可用性、数据库连接与 TLS、数据库迁移、最低实例数 0 的冷启动、环境资源点消耗、默认域名及 Secure Cookie。尚未完成这些步骤，不能宣称线上可用。
- 不创建付费套餐、不升级套餐、不启用自动扣费。下面保留自有服务器方案作为以后迁移的参考，目前不执行服务器购买。

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

当前为单机演示部署，不宣称高可用；仍缺真实上线后的访问质量证据。真实支付、集群和复杂监控不属于原题必需项。
