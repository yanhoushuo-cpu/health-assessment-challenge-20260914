# 实际交付状态 · 2026-09-15

项目：青禾健康评估，Next.js + Prisma + PostgreSQL。

## 可验证成果

- GitHub：[完整代码仓库](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914)
- CI：[Quality 实时状态](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/workflows/ci.yml)
- 首次远端完整 CI 成功：[运行 34837849380](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34837849380)，含 npm ci、lint、typecheck、真实数据库覆盖率、production build、Chromium E2E。此链接对应初次提交，后续修正请以实时状态查看。
- 本地运行：`npm run dev` → http://localhost:3000；在此机器 PostgreSQL 已运行，迁移与 seed 已执行。
- 本地核心测试：90/90 通过（59 domain 单元 + 31 PostgreSQL HTTP 集成）。
- 本地代码检查：lint 无错误/警告，TypeScript strict 通过，production build 通过。
- 后端 src 覆盖率：行 94.27%、语句 94.09%、分支 88.94%、函数 100%；domain 文件四项均 100%。不把 UI 或数据库引擎本身计入该覆盖率。
- 浏览器：Playwright 3/3 通过，实际 Next.js 与数据库上的 funnel、刷新恢复、免费保护字段不存在、模拟支付后完整结果、360px 布局；额外故障重试场景随测试文件提交。
- Demo：本地 paid/unpaid 两份虚构 session；完整 cookie 位于 Git 忽略的 demo-sessions.json。sessionId 本身不是登录凭据。
- Schema：3 份已运行迁移，包含 typed columns、外键/唯一约束、CHECK 和 RLS；README 中有 ER 图。

## 尚未完成的必交项

**没有公网演示 URL；不能视为本挑战全部完成。**

用户明确要求国内、免费公网部署，海外部署已停止。腾讯云上海 CloudBase 免费体验环境已创建且 CLI 已授权，但其 PostgreSQL 共享实例控制台明确禁用数据库直连，现有 Prisma 后端无法直接使用该实例。随后已登录 Sealos 杭州站：余额 5.00，PostgreSQL 0.5 核 / 512 MiB / 3 GiB / 单实例的控制台预估为 0.56/天，另需应用和流量费用。它是按量收费方案，不能称为长期免费；用户已同意最多使用现有 5 元余额进行短期演示，但要求不能欠费。尚未创建收费资源：目前只核实到余额通知，未找到能阻止超支的硬上限。详见[国内部署核验](domestic-deployment.md)。仍无公网业务 URL、线上业务数据或付费测试会话。代码不依赖 SQLite 或进程内数据替代 PostgreSQL。

已增加生产 Dockerfile、Compose、HTTPS 入口、离线镜像导出工作流与真实容器重建后的会话/支付持久化测试。容器验证状态以 [Container deployment](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/workflows/containers.yml) 的实际运行结果为准，不把配置检查代替镜像运行成功。

国内部署第一轮实际验证（代码 `1665bc2`）：[Quality 成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34950477691)，[Container deployment 成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34950477825)，包含生产镜像构建、迁移、测评、鉴权、并发 /pay 和容器重建后的持久化。该轮未执行可选镜像导出，也未验证公网域名/TLS。

最新已核验代码 `7ba8f71`：[Quality 成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34950772111)、[Container deployment 成功](https://github.com/yanhoushuo-cpu/health-assessment-challenge-20260914/actions/runs/34950772156)。以上状态对应明确提交；之后的部署记录文档更新不冒充已由这些运行覆盖。

竞品完整体验也未完成：BetterMe 首页继续按钮会接受第三方条款，尚未获得确认。已实际观察的首页与设计推断分开记在 product-observation.md，不声称查看过未打开的页面。

提交前由候选人填写真实姓名，按【姓名】_全栈挑战_YYYYMMDD 命名文档，并确认 AI 复盘反映自己实际参与的判断。当前未向招聘方发送邮件。

## 审查发现与修复证据

1. 任意小数精度与两位曲线终点冲突、Date 溢出：先出现回归测试失败，再统一 domain 精度与时间验证。
2. 完成接口原本只收空对象：旧标签页会确认最新他人修改；改收 version， stale completion 测试要求409。
3. Prisma P2028：真实并发跑出过500；减少非必要交互事务、显式10秒事务等待、将暂时争用规范为503；测试2连接池+3秒行锁+同key并发。
4. 完成前网络中断/启动加载失败出现空白页：增加可见错误、初始化重试与保存完成后的继续生成入口，Playwright注入一次503后走真实恢复。
5. 本地 PostgreSQL helper 误把已有服务当自己启动：真实复现后增加端口占用拒绝、子进程就绪验证、finally释放映射；独立54339端口实际初始化/启动/建库/停止成功。
6. Supabase Data API 旁路风险：所有业务表迁移开启RLS，不配置浏览器角色策略；以真实非owner读取角色证明不可读取，服务端owner仍可查询。

