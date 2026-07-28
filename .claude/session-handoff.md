# Session Handoff — 2026-07-27 (approx)

## Goal

User is deploying their existing e-commerce application (10 services,
already built as Docker images) onto a **self-managed Kubernetes cluster**
built from scratch on AWS EC2 — explicitly NOT using managed EKS, because
the stated goal is hands-on DevOps/SRE interview practice and a deeper
understanding of how the Kubernetes control plane actually works. This is
happening inside `/Users/dakwojistanley/ecommerce-sre-app` (a separate,
unrelated project from an earlier `aiobs` thread in this same
conversation — that thread is complete/wrapped up, not active).

**Working agreement (explicit, corrected twice by the user — follow exactly):**
- I write/explain everything (Terraform, Ansible, Kubernetes YAML,
  exact commands) — but **I never run commands against AWS/the
  cluster myself, not even "safe" read-only ones**. The user runs
  100% of commands in their own terminal and pastes back output.
- I must **explain what a command does and why** before/alongside
  giving it — bare commands with no teaching content is not acceptable,
  this was explicit, repeated feedback.
- Keep `infra/PROGRESS.md` and `infra/PROGRESS.txt` (kept in sync,
  same content, one plain-text one markdown) updated as a running,
  detailed build log after every phase — explicit user request.

## Current state

**Fully built and healthy:**
- **Terraform** (`infra/terraform/`): VPC, 2 public subnets, 1 shared
  security group, 1 control-plane EC2 + 2 worker EC2 (t3.medium), 1
  Elastic IP (control plane), RDS Postgres (`db.t4g.micro`,
  AWS-managed password via Secrets Manager), ElastiCache Redis
  (`cache.t4g.micro`, no auth). Region `eu-north-1`.
- **Ansible** (`infra/ansible/bootstrap.yml`): all 3 nodes configured
  for kubeadm (containerd, kubelet/kubeadm/kubectl v1.36, sysctl,
  kernel modules).
- **kubeadm cluster**: control-plane + 2 workers all `Ready`. Calico
  v3.32.1 CNI, pod CIDR `192.168.0.0/16`.
- **kubectl access from laptop** via a `klearn` shell alias (defined
  in `~/.zshrc`: `alias klearn='KUBECONFIG=~/.kube/config-k8s-learning
  kubectl'`) — kept fully separate from the user's real work OpenShift
  kubeconfig at the default `~/.kube/config`. The `k8s-learning`
  kubeconfig has `tls-server-name: 10.0.1.140` patched in so it can
  connect via the control plane's *public* IP while validating against
  the cert issued for its *private* IP.
- **Application deployed to the `ecommerce` namespace:**
  - 4 extra Postgres DBs created on RDS (`auth`, `order`, `payment`,
    `inventory`, alongside the original `ecommerce` db).
  - Secrets: `db-credentials`, `mongo-credentials`,
    `app-shared-secrets` (JWT_SECRET + ADMIN_TOKEN), `auth-db-url`,
    `order-db-url`, `payment-db-url`, `inventory-db-url`, `mongo-uri`
    — all built via shell variables, passwords never displayed/typed
    literally in chat.
  - Kafka (single-broker KRaft mode) and MongoDB (single instance,
    root auth) deployed in-cluster, both on ephemeral `emptyDir`
    storage (no real PVs yet).
  - All 10 app images (`bigstan00/ecommerce-<name>:latest` on Docker
    Hub) rebuilt as multi-arch (`linux/amd64,linux/arm64`) — originally
    arm64-only (built on this Apple Silicon Mac), which silently
    couldn't schedule onto the amd64 EC2 nodes. **Note:** the frontend
    image is named `ecommerce-storefront`, not `ecommerce-frontend`.
  - **Healthy, 0 restarts, confirmed Running:** `auth`, `catalog`,
    `payment`, `notification`, `cart`, `inventory`, `order`, `gateway`
    (8 app pods) + `kafka`, `mongodb` (2 infra pods) = 10 pods total in
    `ecommerce` namespace.
  - **NOT yet deployed:** `frontend` (storefront), `admin`.
  - **NOT yet exposed externally** — no NodePort/Ingress set up (the
    security group already allows the NodePort range 30000-32767 from
    anywhere, ready for this).
  - **NOT started at all:** CI/CD, observability stack, hardening
    (RBAC, NetworkPolicies, resource limits, HA control plane, private
    subnets+NAT, EBS CSI driver for real persistent storage).

## ACTIVE BLOCKER — mid-investigation right now, THIS IS WHERE TO RESUME

Gateway's `/readyz` returns `503` — it reports `auth`, `catalog`,
`cart`, and `order` all "unreachable... aborted due to timeout"
(~2000ms, matching the configured `READINESS_TIMEOUT_MS`).

**Confirmed facts, in order of discovery:**
1. This is a genuine cluster networking/DNS problem, not an app bug —
   a completely unrelated pod (`cart`) cannot resolve the plain
   hostname `auth` at all: `wget: bad address 'auth:4001'`.
2. CoreDNS pods are healthy (`Running`, 0 restarts), both scheduled on
   the control-plane node (`ip-10-0-1-140`) — normal/expected.
3. The `kube-dns` Service has valid, populated Endpoints — not an
   empty-endpoints problem.
4. All Calico components (`calico-node`, `calico-apiserver`,
   `calico-typha`, `csi-node-driver`, `calico-kube-controllers`,
   `goldmane`, `whisker`) show `Running`, 0 restarts, on every node
   including the suspect one.
5. **Pattern identified**: the failure is specifically tied to pods
   scheduled on worker node `ip-10-0-1-21` trying to reach pods on
   *other* nodes (control-plane `ip-10-0-1-140`, or earlier, the other
   worker `ip-10-0-2-80`). Same-node traffic seems fine. This exactly
   parallels an **earlier incident this same session**: `catalog`
   crash-looped for 22h (264 restarts) with a MongoDB "context deadline
   exceeded" / `Type: Unknown` error while scheduled on `ip-10-0-1-21`
   trying to reach MongoDB (on `ip-10-0-2-80`) — it only "resolved"
   because a later pod happened to reschedule onto `ip-10-0-2-80`
   instead. Never root-caused at the time.

**Tried and FAILED — do not retry these:**
- Deleted/restarted the `calico-node` pod specifically on
  `ip-10-0-1-21` (came back `Running` fine) — did **not** fix
  `cart`→`auth` DNS resolution.
- Deleted the `cart` pod entirely, letting the Deployment recreate it
  fresh (new pod, still landed on `ip-10-0-1-21`) — did **not** fix it
  either, identical `bad address` error.

**Last action taken, result NOT YET SEEN — this is the very next thing
to check when resuming:**
```
klearn exec -n ecommerce cart-5d56bf59d6-27vqq -- wget -qO- --timeout=5 http://192.168.60.199:9153/metrics
```
This tests raw IP connectivity to a CoreDNS pod's metrics port (HTTP,
9153), deliberately bypassing DNS resolution entirely, to determine
whether the problem is DNS-specific or a general cross-node L3/VXLAN
networking problem between `ip-10-0-1-21` and other nodes.

**Leading hypothesis, not yet tested**: AWS EC2 instances have
`source_dest_check` enabled (`true`) by default, which silently drops
VXLAN-encapsulated overlay traffic not addressed to the instance's own
primary IP — this is a classic, well-known requirement for Calico's
VXLAN/IPIP overlay modes (the setting must be **disabled** on every
node running the CNI overlay). This was **never explicitly set** in
`infra/terraform/ec2.tf` (no `source_dest_check` argument on the
`aws_instance` resources), so it defaults to AWS's own default of
`true` — plausibly the actual root cause. If the raw-IP test above
also fails, check/fix this next:
- Check via `aws ec2 describe-instances --instance-ids i-0758cdda7e9734b8f --query 'Reservations[].Instances[].NetworkInterfaces[].SourceDestCheck'` (worker-0) and the other two instance IDs.
- Fix via Terraform: add `source_dest_check = false` to all three
  `aws_instance` resources in `ec2.tf` (control plane too, for
  consistency, even though it may not be the one currently failing),
  then `terraform apply` (should be an in-place update, not
  destroy/recreate).

## Key infrastructure facts/IDs

- AWS region `eu-north-1`, account `505718060006`.
- Control plane: EC2 `i-047536e3c1599081d`, private `10.0.1.140`,
  public/EIP `13.63.120.61`, node name `ip-10-0-1-140`.
- Worker-0 (**the suspect/problem node**): EC2 `i-0758cdda7e9734b8f`,
  private `10.0.1.21`, node name `ip-10-0-1-21`.
- Worker-1: EC2 `i-06c8eeab3b2dacd3a`, private `10.0.2.80`, node name
  `ip-10-0-2-80`.
- VPC `vpc-0530048471a9921d6`, subnets `subnet-0fc6a646c4ef9164a` (AZ
  a) / `subnet-0ccab64c936462158` (AZ b), security group
  `sg-0ae5e32901f86de3e`.
- RDS endpoint:
  `k8s-learning-postgres.cnuysugk4zul.eu-north-1.rds.amazonaws.com:5432`,
  master user `app_admin`, password in Secrets Manager at ARN
  `arn:aws:secretsmanager:eu-north-1:505718060006:secret:rds!db-41d977f9-2d56-4899-93fc-1ff107536239-mYCBeI`
  — fetch via `aws secretsmanager get-secret-value --secret-id '<arn>'
  --query SecretString --output text` (the `!` in the ARN needs
  single-quoting in zsh or it triggers history expansion — real bug hit
  earlier this session).
- Redis/ElastiCache endpoint:
  `k8s-learning-redis.f3gtjd.0001.eun1.cache.amazonaws.com:6379` (no
  auth, by design).
- SSH key: `~/.ssh/k8s-cluster-key` (private) /
  `~/.ssh/k8s-cluster-key.pub`. SSH as user `ubuntu`.
- CoreDNS pod IPs: `192.168.60.196` and `192.168.60.199`, both on the
  control-plane node. Port 53 = DNS, port 9153 = HTTP metrics.
- **IMPORTANT — shell variables do NOT persist across terminal
  tabs/sessions.** `$DB_USER`, `$DB_PASS`, `$MONGO_USER`,
  `$MONGO_PASS`, `$SECRET_JSON`, `$RDS_HOST` etc. must be re-derived
  fresh in whatever tab is currently active before reuse — this
  silently caused a real bug earlier (an empty username baked into
  `mongo-uri`). The `klearn` alias, by contrast, persists fine since
  it's sourced from `~/.zshrc` on every new shell.
- **`allowed_admin_cidr`** in `infra/terraform/variables.tf` must
  match the user's *current* public laptop IP (dynamic, ISP-assigned,
  unrelated to AWS/the EIP) or SSH/kubectl from the laptop breaks with
  connection timeouts. Last known-good value: `102.88.54.66/32`. Check
  via `curl -s https://checkip.amazonaws.com` and update+`terraform
  apply` if it's changed again (expect this to recur).

## Files changed this session (all under `/Users/dakwojistanley/ecommerce-sre-app/`)

- `infra/terraform/{versions,providers,variables,vpc,security_groups,key_pair,ec2,rds,elasticache,outputs}.tf`
  — full cluster + database infrastructure. `variables.tf`'s
  `allowed_admin_cidr` has been updated twice already for IP changes.
- `infra/ansible/{inventory.ini,ansible.cfg,bootstrap.yml}` — node
  bootstrap playbook, fixed twice (missing `/etc/containerd` dir; a
  sysctl-application task that had to be changed from a
  notify-triggered handler to an unconditional task).
- `infra/k8s/{kafka,mongodb,catalog,payment,notification,auth,cart,order,inventory,gateway}.yaml`
  — all written and applied.
- `infra/PROGRESS.md` and `infra/PROGRESS.txt` — detailed running build
  log, Phases 0–7 documented and in sync with each other. **The current
  Gateway/DNS networking investigation is NOT yet written up there** —
  do this once it's actually resolved.
- `~/.zshrc` — appended the `klearn` alias.

## Decisions made & why (do not re-litigate)

- Self-managed kubeadm, not EKS — explicit goal is understanding the
  control plane for interview depth.
- Single control-plane node, not 3-node HA — reduces first-attempt
  complexity; explicitly flagged as a future hardening step.
- Public subnets, not private+NAT — NAT Gateway costs ~$32/mo;
  explicitly deferred as hardening.
- One shared "allow-all-internal" security group rather than tightly
  per-role-scoped rules — explicit simplification, flagged as hardening.
- RDS + ElastiCache managed; Kafka + MongoDB self-hosted in-cluster —
  cost/complexity tradeoff (DocumentDB/MSK notably pricier and slower
  to provision than justified for a learning cluster).
- Ephemeral storage for Kafka/Mongo (no real PVs) — avoids needing the
  EBS CSI driver + IAM instance profile; explicitly flagged as hardening.
- No Redis AUTH token — security-group network isolation is the
  primary control; explicit, documented tradeoff.

## Failed attempts — do not retry

- Bundling multiple `CREATE DATABASE` statements in one `psql -c`
  argument — Postgres refuses `CREATE DATABASE` inside a transaction
  block. Fixed: separate `-c` flags per statement. (Already fixed,
  working.)
- Assuming AWS RDS-generated passwords are always URI-safe — broke
  Python's `asyncpg` parser. Fixed: percent-encode via `jq`'s `@uri`
  filter before embedding in any connection string. (Already fixed,
  working, applied to all `*-db-url` secrets.)
- `openssl rand -base64` for the self-generated Mongo password — can
  contain URI-breaking characters. Fixed: switched to `rand -hex`.
  (Already fixed, working.)
- Mongo Go driver against a standalone instance without
  `directConnection=true`, while the code calls `readpref.Primary()` —
  hangs with `Type: Unknown`. Fixed: added `directConnection=true` to
  `mongo-uri`. (Already fixed, working.)
- Leaving `sslmode=disable` in Order's `DATABASE_URL` (copied unchanged
  from the local-dev `.env.example`) — RDS prefers SSL, silently hangs
  rather than erroring when refused. Fixed: removed the `sslmode`
  param entirely. (Already fixed, working.)
- **For the current open blocker**: restarting `calico-node` on the
  suspect node did NOT fix it. Recreating the `cart` pod fresh did NOT
  fix it either. Both genuinely tried, both genuinely failed — don't
  suggest either again as if untried.

## Open threads & blockers

- **PRIMARY, ACTIVE**: cross-node pod networking appears broken
  specifically for traffic originating from `ip-10-0-1-21` reaching
  pods on other nodes. Root cause not yet confirmed. See "ACTIVE
  BLOCKER" section above for the exact next diagnostic step and the
  leading `source_dest_check` hypothesis.
- Once resolved: confirm Gateway's `/readyz` actually returns healthy
  for all 5 backend services (not just that pods look `Running`).
- Frontend/Admin's `NEXT_PUBLIC_API_URL` was baked in at Docker image
  *build* time (Next.js build-time env var behavior) — genuinely
  unverified whether the currently-pushed images have a value that
  actually resolves correctly against the in-cluster `gateway` Service.
  Flagged as a real risk to check when deploying them, not yet
  investigated at all.

## Active TODOs / next steps, in order

1. **Resume here**: get the result of the pending raw-IP CoreDNS test
   (`cart` → `192.168.60.199:9153/metrics`). If it also fails/times
   out, pursue the `source_dest_check` hypothesis (see above) — check
   the setting on all 3 instances via AWS CLI/console, and if `true`,
   add `source_dest_check = false` to the `aws_instance` resources in
   `ec2.tf` and `terraform apply` (should be in-place, not
   destroy/recreate). If the raw-IP test *succeeds*, the problem is
   narrower (DNS/port-53-specific) — investigate `/etc/resolv.conf`
   inside affected pods and CoreDNS's own logs next.
2. Once networking is genuinely fixed and confirmed (Gateway `/readyz`
   all green), write up the whole investigation in
   `infra/PROGRESS.md`/`.txt` (Phase 8) — this was a real, substantial
   debugging arc worth documenting like every prior phase.
3. Deploy `frontend` (storefront) and `admin` — verify the
   `NEXT_PUBLIC_API_URL` risk first.
4. Expose the app externally — NodePort to start.
5. Later, explicitly deferred: CI/CD (GitHub Actions), observability
   (Prometheus/Grafana + tracing backend), hardening (RBAC,
   NetworkPolicies, resource limits, HA control plane, private
   subnets+NAT, EBS CSI driver for real PVs, per-role security groups).

## Environment notes

- User runs 100% of commands themselves in their own terminal
  (sometimes across multiple tabs, which causes the shell-variable
  gotcha noted above) — I write/explain, never execute against the
  cluster/AWS myself.
- No CI/CD pipeline exists yet.
- An earlier, unrelated `aiobs` project thread (separate AI-observability
  SaaS platform at `/Users/dakwojistanley/aiobs`) also happened in this
  same conversation before this infra work started — that thread is
  complete and not currently active, no open items there.
- Session has spanned at least 2 calendar days (cluster created
  ~2026-07-25, current work ~2026-07-26/27, based on pod ages of
  23–29h at last check).
