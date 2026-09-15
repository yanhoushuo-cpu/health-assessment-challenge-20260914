# Sealos 短期演示部署

此方案服务于虚构数据演示，不是长期运行架构。用户同意使用现有 5 元余额，禁止充值和欠费。费用按资源及流量计量；以下限制用于控制用量，不声称平台提供了消费硬上限。

## 当前架构

同一 Pod 中运行 PostgreSQL、一次迁移后保持就绪的迁移容器、Next.js 和限流代理。Prisma 只连接 Pod 内的 PostgreSQL，数据库没有公网端口。平台 Ingress 提供 HTTPS；应用保留 Secure Cookie 与来源检查。

数据库使用独立 PVC，所有部署资源的 ownerReference 指向本次 Job，不能指向某一个 Pod。容器或 Pod 重建时 PVC 保留；Job 到期删除后，资源随之回收。演示数据只在演示窗口内保留，不能把这个方案的到期删除说成长期数据保留策略。

Job 最长运行 21600 秒（6 小时），发生连续启动失败也会终止。固定实例，不开启自动扩容；代理限制连接、请求速率和每连接响应速率。CPU、内存、磁盘、迁移容器及流量均需计入预算。资源估算不是防止平台计费延迟、控制器故障或异常流量的绝对保证。

## 已执行的控制验证

- 在真实杭州集群创建 60 秒期限的测试 Job，写入并读取独立测试磁盘。
- 观察到 DeadlineExceeded，随后确认 Job、Pod 和 PVC 全部消失。
- 首次应用启动发现 Nginx 非 root 用户不能创建默认 fastcgi 临时目录；在同权限的独立 Job 中复现错误，显式将各临时目录放进可写 /tmp 后，nginx -t 成功。没有将服务改回 root 用户来掩盖问题。
- 应用与迁移镜像由容器验收成功后发布，标签是明确 Git 提交 SHA；不使用漂移的 latest。

## 可复现的准备步骤

部署清单生成器：`deploy/sealos-demo.prepare.mjs`。参数必须来自本人工作空间和平台生成的域名。它仅写本地被忽略的 `.env.sealos-demo/`，不自动创建云资源。

以下为 Bash 示例。先设置 KUBECONFIG 指向从本人平台下载的配置，再使用实际命名空间和平台域名。不要提交 Kubeconfig、Secret 清单、Cookie 或数据库备份。

```bash
node deploy/sealos-demo.prepare.mjs YOUR_NAMESPACE YOUR_PLATFORM_DOMAIN
kubectl create -f .env.sealos-demo/job.json
export JOB_UID="$(kubectl -n YOUR_NAMESPACE get job qinghe-demo -o jsonpath='{.metadata.uid}')"
node deploy/sealos-demo.prepare.mjs YOUR_NAMESPACE YOUR_PLATFORM_DOMAIN
kubectl apply --dry-run=server -f .env.sealos-demo/resources.json
kubectl apply -f .env.sealos-demo/resources.json
kubectl -n YOUR_NAMESPACE patch job qinghe-demo --type=merge -p '{"spec":{"suspend":false}}'
kubectl -n YOUR_NAMESPACE get jobs,pods,pvc,ingress
```

`resources.pending.json` 尚未附加 ownerReference，禁止直接部署。依赖资源创建失败时，删除刚创建的 qinghe-demo Job，核实关联资源已经回收。不得用全命名空间删除命令。

## 上线验收与结束

必须验证 HTTPS、同源写请求、匿名身份、增量保存、免费 DTO、模拟 /pay、支付重放，以及重建 Pod 后相同会话仍可恢复。通过前不把域名列为已完成交付。

演示结束前将数据库备份和两份虚构会话凭据保存到本地私有交付目录；文件不进入 Git。提前结束时删除本项目 Job，随后检查本项目 Pod、PVC、Service、Ingress、Secret、ConfigMap 均已释放，并检查费用中心实际账单。停止网页进程不能替代资源释放。

## 实际验收补充

最初全局 4 连接限制拒绝并发 JS/CSS，导致页面停留在初始化。代理日志明确显示 limiting connections；改为 16 连接、每连接 8 KiB/s 后，真实浏览器完整流程通过。总带宽理论上限约 128 KiB/s，六小时响应量约 2.7 GiB，仅用于保守用量估算。资源费用和入站等计费不能仅用此数字代替真实账单。

Pod 重建期间 Job/PVC 保留，原会话与支付重放已通过自动断言。当前业务 Job TTL 为完成后 300 秒，backoffLimit 为 3；生成器与实际配置一致。生成器会创建随机密码，只用于首次准备；已部署数据库时禁止重新生成并覆盖 Secret。更新代理仅更新 ConfigMap 并重建 Pod，禁止删除 Job。
