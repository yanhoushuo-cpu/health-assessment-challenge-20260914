# 实际交付状态 · 2026-09-16

候选人：鄢厚硕。

**当前公网已到期，不可用于立即在线评审。** 2026-09-16 实查，本项目 Job、Pod、PVC、Ingress、Service、Secret、ConfigMap 均已清理。以下线上验收是 9 月 15 日的历史成功记录；源码和经过恢复验证的备份仍在本地。重新开启需先核实余额并确定评审窗口。

项目：青禾健康评估，Next.js + Prisma + PostgreSQL。

## 可验证成果

- GitHub：[完整代码仓库](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914)
- CI：[Quality 实时状态](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/workflows/ci.yml)
- 首次远端完整 CI 成功：[运行 34837849380](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34837849380)，含 npm ci、lint、typecheck、真实数据库覆盖率、production build、Chromium E2E。此链接对应初次提交，后续修正请以实时状态查看。
- 本地运行：`npm run dev` → http://localhost:3000；此前已执行迁移与 seed；本地服务需按 README 启动，不假定一直运行。
- 本地核心测试：90/90 通过（59 domain 单元 + 31 PostgreSQL HTTP 集成）。
- 本地代码检查：lint 无错误/警告，TypeScript strict 通过，production build 通过。
- 后端 src 覆盖率：行 94.27%、语句 94.09%、分支 88.94%、函数 100%；domain 文件四项均 100%。不把 UI 或数据库引擎本身计入该覆盖率。
- 浏览器：Playwright 3/3 通过，实际 Next.js 与数据库上的 funnel、刷新恢复、免费保护字段不存在、模拟支付后完整结果、360px 布局；额外故障重试场景随测试文件提交。
- Demo：本地 paid/unpaid 两份虚构 session；完整 cookie 位于 Git 忽略的 demo-sessions.json。sessionId 本身不是登录凭据。
- Schema：3 份已运行迁移，包含 typed columns、外键/唯一约束、CHECK 和 RLS；README 中有 ER 图。

## 线上验收与交付

- 公网：[青禾健康评估](https://uvyxrpacfugt.sealoshzh.site/)，Sealos 杭州，HTTPS。
- 运行镜像对应代码：`3099c1d6ecd893e8a5e6212edf46269e01a34f2f`。[Quality 成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34955489643)、[容器验收和镜像发布成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34955491433)。后续部署脚本和文档变更不冒充此镜像代码。
- 2026-09-15 本机 Edge 实际打开公网，填写年龄后刷新恢复到性别步骤，完成五步后显示免费 BMI 26.2，确认 ¥0 模拟弹窗后显示 BMR 1830、每日总消耗 2837、建议热量 2337 及预测曲线。未声称独立多地域或无代理网络验收。
- HTTPS API 验收验证 401、422 数字字符串、403 非同源写入、逐步恢复、免费 DTO 仅三个字段、并发相同幂等键支付及付费结果。
- 仅重建 Pod，保留 Job/PVC；相同会话、结果、paymentId 和订阅到期时间全部保留，自动断言通过。
- 已支付 sessionId：`2c217615-a47c-467e-bc5f-ea3e383bb217`。
- 未支付 sessionId：`d8bc65fe-6609-4899-94f4-f4b87f27cfee`。
- 私有交付文件 `线上演示会话.json` 含两份虚构会话 cookie；sessionId 不是认证凭据。文件和数据库备份在本地 outputs，不提交公共仓库。
- 数据库自定义格式备份 `qinghe-demo.dump` 已导出，并成功恢复到独立临时库；六张业务表、约束及 RLS 均恢复，查询确认 2 份付费会话，验证库随后清理。

### 公网重放

将私有交付文件中的 paid.cookie 填入 COOKIE。首次调用与再次调用使用相同键，返回原 paymentId，不延长订阅。未支付对比使用 unpaid.cookie 调用 GET /api/v1/result；不要先对未支付会话调用 /pay。

```bash
BASE='https://uvyxrpacfugt.sealoshzh.site'
COOKIE='从私有交付文件复制 paid.cookie'
curl -sS "$BASE/api/v1/result" -H "Cookie: $COOKIE"
curl -sS "$BASE/pay" -X POST -H "Origin: $BASE" -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -H 'Idempotency-Key: container-payment-001' --data '{"plan":"premium"}'
```

Windows PowerShell 请使用 curl.exe。完整从零建立会话的流程见 README 的 API 示例。

### 演示有效期及待本人确认项

当前 Job 于 UTC 2026-09-15 10:11:22 启动，最长 6 小时，即北京时间 **2026-09-16 00:11:22** 停止，之后约五分钟自动清理，控制器调度可能有延迟。PVC 会随 Job 清理，长期恢复应使用本地备份重新部署。未充值、未升级；限流和资源上限不是平台金额硬上限。此期限不等于持续六小时人工验收。

2026-09-16 用户已确认姓名鄢厚硕并同意竞品条款；现已走完竞品问卷到付费确认边界，未购买，见 product-observation.md。AI 复盘保留真实用户否决海外部署的记录，不编造本人代码审查经历。本项目未向招聘邮箱发件。

## 审查发现与修复证据

1. 任意小数精度与两位曲线终点冲突、Date 溢出：先出现回归测试失败，再统一 domain 精度与时间验证。
2. 完成接口原本只收空对象：旧标签页会确认最新他人修改；改收 version， stale completion 测试要求409。
3. Prisma P2028：真实并发跑出过500；减少非必要交互事务、显式10秒事务等待、将暂时争用规范为503；测试2连接池+3秒行锁+同key并发。
4. 完成前网络中断/启动加载失败出现空白页：增加可见错误、初始化重试与保存完成后的继续生成入口，Playwright注入一次503后走真实恢复。
5. 本地 PostgreSQL helper 误把已有服务当自己启动：真实复现后增加端口占用拒绝、子进程就绪验证、finally释放映射；独立54339端口实际初始化/启动/建库/停止成功。
6. Supabase Data API 旁路风险：所有业务表迁移开启RLS，不配置浏览器角色策略；以真实非owner读取角色证明不可读取，服务端owner仍可查询。
