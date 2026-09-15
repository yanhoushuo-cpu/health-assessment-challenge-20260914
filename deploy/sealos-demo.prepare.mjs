import fs from "node:fs";
import crypto from "node:crypto";
const [ns, domain] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(ns ?? "") || !/^[a-z0-9.-]+$/.test(domain ?? ""))
  throw new Error(
    "Usage: node deploy/sealos-demo.prepare.mjs NAMESPACE DOMAIN",
  );
const name = "qinghe-demo";
const image = "ghcr.io/yanhoushuo-cpu/health-assessment-challenge-20260914";
const tag = "3099c1d6ecd893e8a5e6212edf46269e01a34f2f";
const dir = new URL("../.env.sealos-demo/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const pass = crypto.randomBytes(32).toString("hex");
const labels = { "app.kubernetes.io/part-of": "qinghe-short-demo", app: name };
const meta = (n = name) => ({ name: n, namespace: ns, labels });
const resources = (cpu, memory) => ({
  requests: { cpu, memory },
  limits: { cpu, memory, "ephemeral-storage": "512Mi" },
});
const securityContext = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] },
};
const env = [
  {
    name: "DATABASE_URL",
    valueFrom: { secretKeyRef: { name, key: "DATABASE_URL" } },
  },
  { name: "DEMO_MODE", value: "true" },
  { name: "APP_ORIGIN", value: `https://${domain}` },
];
const ready = { name: "ready", mountPath: "/ready" };
const job = {
  apiVersion: "batch/v1",
  kind: "Job",
  metadata: meta(),
  spec: {
    suspend: true,
    activeDeadlineSeconds: 21600,
    ttlSecondsAfterFinished: 300,
    backoffLimit: 3,
    template: {
      metadata: { labels },
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: "OnFailure",
        terminationGracePeriodSeconds: 10,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
          seccompProfile: { type: "RuntimeDefault" },
        },
        containers: [
          {
            name: "db",
            image: "postgres:17-alpine",
            securityContext: {
              ...securityContext,
              runAsUser: 70,
              runAsGroup: 70,
            },
            resources: resources("200m", "256Mi"),
            env: [
              { name: "POSTGRES_USER", value: "health" },
              { name: "POSTGRES_DB", value: "health" },
              {
                name: "POSTGRES_PASSWORD",
                valueFrom: { secretKeyRef: { name, key: "POSTGRES_PASSWORD" } },
              },
              { name: "PGDATA", value: "/data/pgdata" },
            ],
            volumeMounts: [{ name: "database", mountPath: "/data" }],
            readinessProbe: {
              exec: { command: ["pg_isready", "-U", "health", "-d", "health"] },
              initialDelaySeconds: 5,
              periodSeconds: 5,
            },
          },
          {
            name: "migrate",
            image: `${image}/migrate:${tag}`,
            securityContext,
            resources: resources("200m", "256Mi"),
            env,
            command: ["sh", "-c"],
            args: [
              "for i in $(seq 1 30); do node node_modules/prisma/build/index.js migrate deploy && touch /ready/migrated && exec sleep infinity; sleep 2; done; exit 1",
            ],
            volumeMounts: [ready],
            readinessProbe: {
              exec: { command: ["test", "-f", "/ready/migrated"] },
              periodSeconds: 5,
            },
          },
          {
            name: "app",
            image: `${image}/app:${tag}`,
            securityContext,
            resources: resources("200m", "512Mi"),
            env,
            command: ["sh", "-c"],
            args: [
              "while [ ! -f /ready/migrated ]; do sleep 1; done; exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0",
            ],
            volumeMounts: [ready],
            readinessProbe: {
              httpGet: { path: "/", port: 3000 },
              periodSeconds: 5,
              timeoutSeconds: 3,
            },
          },
          {
            name: "proxy",
            image: "nginx:1.28-alpine",
            securityContext,
            resources: resources("50m", "64Mi"),
            command: ["nginx", "-g", "daemon off;"],
            volumeMounts: [
              {
                name: "proxy-config",
                mountPath: "/etc/nginx/nginx.conf",
                subPath: "nginx.conf",
                readOnly: true,
              },
              { name: "proxy-temp", mountPath: "/tmp" },
            ],
            readinessProbe: {
              httpGet: { path: "/", port: 8080 },
              periodSeconds: 5,
              timeoutSeconds: 3,
            },
          },
        ],
        volumes: [
          { name: "database", persistentVolumeClaim: { claimName: name } },
          { name: "ready", emptyDir: {} },
          { name: "proxy-temp", emptyDir: { sizeLimit: "32Mi" } },
          { name: "proxy-config", configMap: { name } },
        ],
      },
    },
  },
};
const nginx = `pid /tmp/nginx.pid;
events { worker_connections 64; }
http {
  access_log off;
  error_log /dev/stderr warn;
  client_body_temp_path /tmp/body;
  proxy_temp_path /tmp/proxy;
  fastcgi_temp_path /tmp/fastcgi;
  uwsgi_temp_path /tmp/uwsgi;
  scgi_temp_path /tmp/scgi;
  limit_conn_zone $server_name zone=global_connections:64k;
  limit_req_zone $server_name zone=global_requests:64k rate=10r/s;
  server {
    listen 8080;
    server_name _;
    client_max_body_size 16k;
    limit_conn global_connections 16;
    limit_req zone=global_requests burst=20 nodelay;
    limit_rate 8k;
    gzip on;
    gzip_types text/css application/javascript application/json;
    location / {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering on;
    }
  }
}
`;
const items = [
  {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: meta(),
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: "openebs-lvmpv",
      resources: { requests: { storage: "1Gi" } },
    },
  },
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: meta(),
    stringData: {
      POSTGRES_PASSWORD: pass,
      DATABASE_URL: `postgresql://health:${pass}@127.0.0.1:5432/health?schema=public&connection_limit=5&pool_timeout=10`,
    },
  },
  {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: meta(),
    data: { "nginx.conf": nginx },
  },
  {
    apiVersion: "v1",
    kind: "Service",
    metadata: meta(),
    spec: {
      selector: { app: name },
      ports: [{ port: 80, targetPort: 8080, name: "http" }],
    },
  },
  {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      ...meta(),
      annotations: {
        "kubernetes.io/ingress.class": "nginx",
        "nginx.ingress.kubernetes.io/proxy-body-size": "16k",
        "nginx.ingress.kubernetes.io/ssl-redirect": "true",
      },
    },
    spec: {
      rules: [
        {
          host: domain,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: { service: { name, port: { number: 80 } } },
              },
            ],
          },
        },
      ],
      tls: [{ hosts: [domain], secretName: "wildcard-cert" }],
    },
  },
];
fs.writeFileSync(new URL("job.json", dir), JSON.stringify(job, null, 2));
const ownerUid = process.env.JOB_UID;
if (ownerUid && !/^[a-f0-9-]{36}$/.test(ownerUid))
  throw new Error("Invalid JOB_UID");
if (ownerUid)
  for (const item of items)
    item.metadata.ownerReferences = [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        name,
        uid: ownerUid,
        controller: false,
        blockOwnerDeletion: false,
      },
    ];
fs.writeFileSync(
  new URL(ownerUid ? "resources.json" : "resources.pending.json", dir),
  JSON.stringify({ apiVersion: "v1", kind: "List", items }, null, 2),
);
fs.writeFileSync(
  new URL("release.json", dir),
  JSON.stringify(
    { namespace: ns, name, domain, tag, maxSeconds: 21600 },
    null,
    2,
  ),
);
console.log("Prepared private manifests. No cloud resources created.");
