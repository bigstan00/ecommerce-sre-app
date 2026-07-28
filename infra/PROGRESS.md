# Kubernetes cluster build log — self-managed `kubeadm` cluster on AWS EC2

## Goal and why this approach

Deploy the existing e-commerce application (10 services, already built and
pushed as Docker images) onto a real Kubernetes cluster, built the way a
production infrastructure/SRE engineer would actually build one — not a
managed service that hides the mechanics.

**Deliberately NOT using AWS EKS.** EKS runs the control plane (API
server, etcd, scheduler, controller-manager) entirely inside AWS's own
account — you never see or touch it. The explicit goal here was deeper
understanding of how the control plane actually works, which only comes
from standing it up yourself with `kubeadm` on plain EC2 instances.

**Toolchain and division of labor:**
- **Terraform** — provisions infrastructure (VPC, EC2 instances). Declarative, does not touch what's running *inside* a machine.
- **Ansible** — configures what's inside each machine once it exists (installs packages, edits config files). Configuration management, not provisioning.
- **kubeadm** — the actual "turn this Linux box into a Kubernetes node" tool.

This mirrors a real-world pattern: Terraform builds the boxes, Ansible
configures the boxes, kubeadm turns them into a cluster.

---

## Phase 0 — Tooling and AWS access

Installed via Homebrew:
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform   # HashiCorp pulled Terraform out of homebrew-core after their license change — needs their own tap
brew install ansible
brew install awscli
```

**AWS authentication.** Started down the IAM Identity Center (SSO) path,
switched to a plain IAM user for speed:
- IAM console → Users → Create user → attached `AdministratorAccess` policy directly (acceptable for a personal learning account; a real job would scope this to least-privilege)
- Security credentials tab → Create access key → use case "Command Line Interface (CLI)"
- Ran `aws configure` locally with the resulting Access Key ID / Secret Access Key, region `eu-north-1` (Stockholm)
- Verified with `aws sts get-caller-identity`

**SSH key pair**, dedicated to this project:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/k8s-cluster-key -C "k8s-cluster-learning" -N ""
```
Produces `~/.ssh/k8s-cluster-key` (private, stays on this machine forever) and
`~/.ssh/k8s-cluster-key.pub` (public, safe to upload to AWS — this is what
Terraform registers so EC2 instances trust it for SSH login).

---

## Phase 1 — Networking (Terraform)

Location: `infra/terraform/`

| File | Purpose |
|---|---|
| `versions.tf` | Pins Terraform CLI (`>= 1.7.0`) and the AWS provider (`~> 5.0`) — prevents an unpinned provider from silently jumping to a breaking new major version on a fresh `terraform init`. |
| `providers.tf` | Configures the AWS provider (region from a variable) and applies default tags (`Project`, `ManagedBy`) to every resource this project creates, so they're all identifiable in the AWS console. |
| `variables.tf` | All the tunable inputs: `aws_region` (`eu-north-1`), `project_name` (`k8s-learning`), `vpc_cidr` (`10.0.0.0/16`), `public_subnet_cidrs` (two /24s across two AZs), `allowed_admin_cidr` (your own public IP as a /32 — auto-detected via `curl checkip.amazonaws.com`), `ssh_public_key_path`. |
| `vpc.tf` | The actual network: one VPC, one Internet Gateway, two public subnets (one per Availability Zone — spreading across AZs is a real production concern even though the control plane itself is single-node for now), one route table sending `0.0.0.0/0` traffic to the Internet Gateway, associated with both subnets. |
| `security_groups.tf` | One shared security group for every cluster node. Rules: (1) allow **all** traffic between members of the group itself (a deliberate simplification — real production splits this into tightly-scoped per-role rules for the specific ports each role needs, e.g. 6443 for the API server, 2379-2380 for etcd, 10250 for kubelet); (2) SSH (22) from `allowed_admin_cidr` only — never opened to `0.0.0.0/0`; (3) Kubernetes API (6443) from `allowed_admin_cidr` only; (4) NodePort range (30000-32767) open to the whole internet, for testing services externally (flagged as something a real Ingress/Load Balancer should replace later); (5) all outbound traffic allowed. |
| `key_pair.tf` | Uploads the **public** half of the SSH key (`~/.ssh/k8s-cluster-key.pub`) to AWS as a registered key pair — this is what gets injected into every EC2 instance's `authorized_keys` at boot. |
| `outputs.tf` | Exposes VPC id, subnet ids, security group id, key pair name (later extended with instance IPs in Phase 2). |

**Bug hit and fixed:** the original `nodeport` security group rule's
`description` field used an em-dash (`—`). AWS security group rule
descriptions only accept a narrow character set and rejected it —
`terraform plan` failed with a validation error. Fixed by replacing the
em-dash with plain parentheses.

**Applied cleanly:** `terraform init` → `terraform plan` (14 resources) →
`terraform apply` → **14 added, 0 changed, 0 destroyed.** Free — VPCs,
subnets, security groups, and key pairs don't cost anything; cost only
starts in Phase 2.

---

## Phase 2 — Compute (Terraform)

New file: `infra/terraform/ec2.tf`

- `data "aws_ami" "ubuntu"` — looks up the latest official Ubuntu 22.04 LTS AMI dynamically (owner `099720109477`, Canonical's account) instead of hardcoding an AMI id, which would rot as Canonical ships patches.
- `aws_instance.control_plane` — one `t3.medium` (kubeadm's documented minimum: 2 vCPU / 4GB RAM), 30GB gp3 root volume (default 8GB is too tight once pulling container images), tagged `Role = control-plane`. Deliberately bare — no software installed by Terraform; that's Ansible's job next.
- `aws_instance.worker` — two more `t3.medium`s, spread across both Availability Zones (`count.index % length(aws_subnet.public)`), same sizing.
- `aws_eip.control_plane` — a **static** Elastic IP attached to the control-plane instance specifically. This matters mechanically: the control plane's IP gets baked into every worker's join command and into the TLS certificates `kubeadm` generates. An ordinary auto-assigned public IP *changes* if the instance is stopped and restarted — which would silently break the whole cluster. An EIP persists across stop/start, and costs nothing extra as long as it stays attached to a running instance.
- `outputs.tf` extended with `control_plane_public_ip`, `control_plane_private_ip`, `worker_public_ips`, `worker_private_ips`.

**Cost note, explicitly flagged at the time:** ~$0.14/hour combined for
three `t3.medium` instances in `eu-north-1` (~$3.30/day if left running
continuously) — this is the point where the project stopped being free.

**Applied cleanly:** `terraform plan` (4 resources) → `terraform apply` →
**4 added, 0 changed, 0 destroyed** — confirmed additive-only, nothing
from Phase 1 touched.

**Resulting nodes:**
| Node | Public IP | Private IP |
|---|---|---|
| control-plane | `13.63.120.61` (static/EIP) | `10.0.1.140` |
| worker-0 | `51.20.117.73` | `10.0.1.21` |
| worker-1 | `13.60.20.61` | `10.0.2.80` |

Sanity-checked with a manual SSH into the control plane
(`ssh -i ~/.ssh/k8s-cluster-key ubuntu@13.63.120.61`) — confirmed the
whole chain (key, security group, DNS/IP) actually works end to end.

---

## Phase 3 — OS bootstrap (Ansible)

Location: `infra/ansible/`

| File | Purpose |
|---|---|
| `inventory.ini` | Lists all 3 nodes by IP (copied from `terraform output`), grouped `[control_plane]` / `[workers]`, with the shared SSH user (`ubuntu`) and key path. |
| `ansible.cfg` | Points at the inventory file; disables the interactive host-key-checking prompt (acceptable here specifically because these are servers we just created ourselves seconds earlier via Terraform — not something to do for a server you didn't provision yourself). |
| `bootstrap.yml` | The actual playbook — runs identically against all 3 nodes (`hosts: all`), since control-plane-vs-worker differences don't start until `kubeadm init`/`join`. |

**What `bootstrap.yml` does, task by task:**
1. **Disable swap** (`swapoff -a`, plus comment out swap lines in `/etc/fstab` so it stays off after reboot) — `kubelet` refuses to start with swap enabled; Kubernetes needs full, predictable control over memory to enforce resource limits.
2. **Load kernel modules** `overlay` (the filesystem driver containerd uses to layer container images) and `br_netfilter` (lets the kernel's iptables rules see traffic crossing a Linux network bridge — required for pod networking) — written to `/etc/modules-load.d/k8s.conf` so they persist across reboot, and loaded immediately via `modprobe`.
3. **Set sysctl kernel parameters** (`net.bridge.bridge-nf-call-iptables`, `net.bridge.bridge-nf-call-ip6tables`, `net.ipv4.ip_forward`, all `= 1`) — written to `/etc/sysctl.d/k8s.conf`, then **applied to the running kernel** via `sysctl --system` as its own unconditional task (see bug #2 below for why this had to be unconditional rather than a notify-triggered handler).
4. **Install containerd** (the container runtime — Kubernetes doesn't run containers itself, it delegates to a CRI-compatible runtime; containerd is the modern standard since Docker was dropped as a direct runtime years ago) plus prerequisites (`ca-certificates`, `curl`, `gnupg`).
5. **Ensure `/etc/containerd` exists**, then generate containerd's default config into it.
6. **Fix containerd's cgroup driver**: flips `SystemdCgroup = false` to `true` in containerd's config. This is the single most common from-scratch kubeadm gotcha — `kubelet` expects the `systemd` cgroup driver, containerd's own default doesn't match, and the mismatch causes a flaky, confusing-to-debug `kubelet` if left alone.
7. **Enable and start containerd.**
8. **Add Kubernetes's own apt repository** (`pkgs.k8s.io`, version-pinned to `v1.36` — the current stable minor version, verified via `https://dl.k8s.io/release/stable.txt` rather than assumed) — downloads and registers the signing key, adds the repo source list.
9. **Install `kubelet`, `kubeadm`, `kubectl`.**
10. **Pin their versions** (`apt-mark hold` equivalent, via the `dpkg_selections` module) — stops a routine `apt upgrade` from silently changing the Kubernetes version mid-operation; version upgrades on a real cluster are always a deliberate, coordinated action.
11. **Enable the `kubelet` service** (it won't fully start until `kubeadm init`/`join` gives it something to do, but enabling it now is standard).

**Two real bugs hit and fixed here:**

- **Bug 1 — missing directory.** The first run failed at "generate containerd's default config" with `cannot create /etc/containerd/config.toml: Directory nonexistent`. Ubuntu's `containerd` apt package doesn't actually create `/etc/containerd/` on install — wrongly assumed it would. **Fix:** added an explicit `file: state=directory` task before writing into it.

- **Bug 2 — Ansible handler semantics silently no-op'd a critical setting.** The sysctl task originally *notified* a handler (`Apply sysctl`, running `sysctl --system`) instead of running it directly. Handlers only fire if the notifying task reports `changed`, **and only at the end of the play.** On the first run, the file was written (`changed`) and the handler was notified — but that same run failed on a later task before reaching the end, so the queued handler never actually executed. On the second (otherwise successful) run, the file already had the correct content, so the task reported `ok` (not `changed`) and never notified the handler *at all*. Net effect: the config file was correct on disk through both runs, but the setting was **never actually loaded into the running kernel** — invisible until `kubeadm init`'s preflight check caught it (`/proc/sys/net/ipv4/ip_forward contents are not set to 1`). **Fix:** replaced the handler with an unconditional task that always runs `sysctl --system` — cheap and safe to re-run, and removes the whole failure class.

**Final clean run:** `ok=18 changed=9 failed=0` across all three hosts.

---

## Phase 4 — Creating the cluster (`kubeadm`)

### `kubeadm init` on the control plane

```bash
sudo kubeadm init --pod-network-cidr=192.168.0.0/16 --apiserver-advertise-address=10.0.1.140
```

- `--pod-network-cidr=192.168.0.0/16` — reserves an IP range for pod-to-pod networking (used by Calico next), deliberately distinct from the VPC's own `10.0.0.0/16` to avoid any address collision between "real" AWS networking and "virtual" pod networking.
- `--apiserver-advertise-address=10.0.1.140` — the control plane's **private** IP, not its public one. Worker-to-control-plane traffic stays entirely inside the VPC's internal network; there's no reason to route it out to the public internet and back.

**What it actually does:** generates every TLS certificate the cluster needs, starts `etcd` (the cluster's database — every Kubernetes object ultimately lives here), starts the API server/scheduler/controller-manager, and prints a one-time `kubeadm join` command with a token for the workers.

**Bug hit:** first attempt failed at the preflight-check stage —
`/proc/sys/net/ipv4/ip_forward contents are not set to 1` — this was
exactly Ansible Bug 2 above, surfacing here because the setting had never
actually been loaded into the kernel despite the config file being
correct. **Fix:** corrected the playbook (above) and re-ran it against
all three nodes, which actually applied the sysctl settings live this
time. Retried `kubeadm init` — succeeded cleanly.

**Join command captured** (needed to bring the workers in — token has a default 24h TTL):
```
kubeadm join 10.0.1.140:6443 --token czhdbk.j8gmw6xrwmmn9iif \
  --discovery-token-ca-cert-hash sha256:64c5a78d4e9fa7e474a6eff532abe7035f85d9773f3b40cd9475a56e75daedfc
```

### `kubectl` access on the control plane

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

`kubectl get nodes` at this point showed the control-plane node as
**`NotReady`** — expected, not a bug: a fresh control plane has no pod
networking configured yet, so Kubernetes correctly refuses to call it
Ready.

### Installing Calico (the CNI)

Verified rather than assumed:
- Current stable release: `v3.32.1` (checked via GitHub's release API)
- Calico's default pod CIDR in `custom-resources.yaml`: confirmed `192.168.0.0/16` — matches exactly what `kubeadm init` was configured with, no edits needed
- Default encapsulation mode is VXLAN — already covered by the security group's broad "allow all traffic between cluster members" rule, no extra security-group change needed

```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.32.1/manifests/tigera-operator.yaml
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.32.1/manifests/custom-resources.yaml
```

The first installs the **Tigera operator** (a controller that manages the
real Calico installation, rather than applying one giant static
manifest); the second tells the operator how to configure it.

**Why the node went from `NotReady` to `Ready`:** Kubernetes tracks node
health via a set of Conditions kubelet reports to the API server,
including `NetworkUnavailable`. A fresh node has this set to `True`,
which blocks the overall `Ready` condition regardless of anything else
being healthy. Once the operator deployed Calico's `calico-node` agent
(a DaemonSet — one copy per node, automatically) and that agent finished
setting up the node's actual pod networking (CNI config, routes, IP
address management for `192.168.0.0/16`), `kubelet` detected the valid
CNI config and flipped `NetworkUnavailable` to `False` — which cleared
the way for `Ready` to become `True`.

Verified directly (not just trusted) via:
```bash
kubectl describe node ip-10-0-1-140
```
— showing `NetworkUnavailable: False` and `Ready: True` explicitly, with
timestamps.

---

## Joining the workers

Ran the captured `kubeadm join` command on each worker via SSH.

**Bug hit — the same root cause struck twice.** `worker-0`'s join
attempt failed at the identical preflight check as the control plane
earlier (`/proc/sys/net/ipv4/ip_forward contents are not set to 1`).
Root cause: after fixing Ansible Bug 2 and unblocking the control plane,
the fix was applied there by hand (`sudo sysctl --system` directly over
SSH) rather than by re-running the corrected `bootstrap.yml` against all
three hosts — so the underlying automation was fixed, but the actual
fleet state never converged to match it on the two workers. **Fix:** ran
`sudo sysctl --system` manually on each worker immediately before its
join attempt. Both then joined cleanly.

**Lesson worth keeping**: fixing a playbook isn't the same as fixing the
fleet — a corrected `.yml` file changes nothing on a machine until it's
actually re-run against that machine. Patching one host by hand while
leaving the automation unrun on the others creates silent drift between
"what the code says should be true" and "what's actually true" — exactly
the kind of gap that causes confusing failures days or weeks later. The
right fix here would have been re-running `ansible-playbook bootstrap.yml`
against all three hosts the moment the playbook was corrected, not
patching the control plane by hand and moving on.

## Current state

**Cluster fully operational — 3/3 nodes `Ready`:**
```
NAME            STATUS   ROLES           VERSION
ip-10-0-1-140   Ready    control-plane   v1.36.3
ip-10-0-1-21    Ready    <none>          v1.36.3
ip-10-0-2-80    Ready    <none>          v1.36.3
```

This is a complete, working self-managed Kubernetes cluster — control
plane and both workers built from bare EC2 instances, entirely by hand
(Terraform for infrastructure, Ansible for configuration, kubeadm for
cluster bootstrap), with real bugs hit and fixed along the way rather
than a clean scripted happy path.

---

## Phase 5 — Managed databases (Terraform)

Scoping decision: rather than running every stateful service in-cluster,
split by cost/complexity —
- **Postgres (RDS) and Redis (ElastiCache)**: managed by AWS — cheap (~$27-37/month combined) and quick to provision, genuinely worth it.
- **Kafka and MongoDB**: kept self-hosted, in-cluster — AWS's managed equivalents (MSK, DocumentDB) are meaningfully more expensive (~$60+/month each) and, for MSK specifically, much slower/fussier to provision and secure. Not worth it for a learning cluster.

New files: `infra/terraform/rds.tf`, `infra/terraform/elasticache.tf`

- `aws_db_subnet_group` / `aws_elasticache_subnet_group` — reuse the same two public subnets the cluster nodes live in. (The database itself is NOT internet-reachable regardless of subnet — that's controlled separately by `publicly_accessible = false` on the RDS instance, not by subnet choice.)
- `aws_security_group.rds` / `aws_security_group.elasticache` — dedicated security groups, each with exactly one rule: allow the relevant port (5432 / 6379) **from the cluster's own security group specifically** (`source_security_group_id`, not a CIDR block) — the idiomatic way to say "only my Kubernetes nodes," which stays correct even if node IPs change.
- `aws_db_instance.postgres` — `db.t4g.micro`, single-AZ, 20GB gp3, `manage_master_user_password = true`. That last setting means AWS generates and rotates the master password automatically via Secrets Manager — **Terraform (and its state file) never see the plaintext password at all**, avoiding the common anti-pattern of a self-generated password sitting in `.tfstate` forever.
- `aws_elasticache_cluster.redis` — `cache.t4g.micro`, single node, no AUTH token, no in-transit encryption. Documented explicitly as a deliberate trade-off, not an oversight: ElastiCache doesn't have the same automatic-secrets-management feature RDS does, and since access is already restricted to exactly the cluster's nodes via the security group, the incremental benefit of also adding AUTH is small relative to the extra secret-handling complexity for a learning cluster.
- `outputs.tf` extended with `rds_endpoint`, `rds_master_user_secret_arn`, `redis_endpoint`.

**Real bugs hit, both transient/environmental, not code issues:**
- A DNS resolution failure (`no such host` for the EC2 API endpoint) mid-apply — a momentary local network/DNS hiccup, confirmed by the two subnet-group resources succeeding immediately before it. Fixed by simply retrying `terraform apply` (idempotent — already-created resources weren't touched again).
- A stale Terraform state lock left over from that interrupted apply, blocking the retry. `terraform force-unlock` reported it couldn't unlock (the previous process hadn't finished releasing it yet); resolved on its own moments later without forcing anything.

**Applied cleanly on retry:** `Plan: 6 to add` (RDS instance, ElastiCache cluster, both security groups, both security group rules) → **6 added, 0 changed, 0 destroyed.** ElastiCache took ~3m47s, RDS took ~6m25s to actually become available — normal for managed database provisioning, not a hang.

**Resulting endpoints:**
```
rds_endpoint   = k8s-learning-postgres.cnuysugk4zul.eu-north-1.rds.amazonaws.com:5432
redis_endpoint = k8s-learning-redis.f3gtjd.0001.eun1.cache.amazonaws.com
```
Postgres password: not yet retrieved — sits in Secrets Manager at the ARN in `rds_master_user_secret_arn`, to be fetched when wiring up Kubernetes Secrets for the app.

---

## Phase 6 — Cluster access + application deployment (kubectl, Kubernetes manifests)

**kubectl from the laptop, not just via SSH.** Copied the cluster's kubeconfig down (`/etc/kubernetes/admin.conf` is root-owned, so this needs `sudo cat` piped over SSH rather than a plain `scp`). It pointed at the control plane's *private* IP, which a laptop outside the VPC can't reach — fixed by adding `tls-server-name: 10.0.1.140` to the kubeconfig, which lets the client connect over the *public* IP while still validating the certificate against the private IP it was actually issued for (safer than regenerating the live cluster's certificate, which was the other option). Kept this cluster's kubeconfig completely separate from the pre-existing default `~/.kube/config` (which points at a real, unrelated work OpenShift production cluster) via a `klearn` shell alias, rather than merging/overwriting anything.

**Namespace, secrets, and databases created for the app:**
- `ecommerce` namespace.
- 4 additional Postgres databases created on the shared RDS instance (`auth`, `order`, `payment`, `inventory` — the app's design uses one database per service, not one shared one) via a disposable `kubectl run` pod with the `postgres` image.
- `db-credentials` (RDS/ElastiCache endpoints), `mongo-credentials`, `app-shared-secrets` (JWT_SECRET + ADMIN_TOKEN, identical across the services that need them), and per-service composed connection-string secrets (`auth-db-url`, `order-db-url`, `payment-db-url`, `inventory-db-url`, `mongo-uri`) — all built entirely from shell variables, no password ever displayed or typed literally.

**Kafka and MongoDB deployed in-cluster** (`infra/k8s/kafka.yaml`, `mongodb.yaml`) — single-broker/single-instance, ephemeral storage, matching the earlier scoping decision.

**First batch of application services deployed** (`infra/k8s/{auth,catalog,payment,notification}.yaml`) — chosen specifically because none of them call any other application service, only their own data store.

### Real bugs hit and fixed, this phase

1. **Every pushed image was `arm64`-only — none of them could run on the cluster.** All 10 images were built on this Apple-Silicon Mac without multi-platform output, so they only had an `arm64` manifest; the cluster's EC2 nodes are `amd64`. Confirmed directly (`docker manifest inspect`) rather than assumed. **Fix**: rebuild and push as multi-arch with `docker buildx build --platform linux/amd64,linux/arm64 --push`. This will need to be repeated for the remaining 6 images (Cart, Order, Inventory, Gateway, Frontend, Admin) as each is deployed.

2. **RDS's auto-generated password broke Python's Postgres URI parsing.** Payment (Python/`asyncpg`) crashed with `invalid literal for int() with base 10: 'tBGZ'` — a special character in the auto-generated password was being misinterpreted as part of the host/port section of the connection string. Auth (Node/`pg`) had happened to parse the identical string successfully — Node's driver is more forgiving about where it splits a connection string; Python's is stricter. **Fix**: properly percent-encode (`jq`'s `@uri` filter) the username/password before embedding them in any connection string, rather than relying on a driver being lenient about it — the standards-correct approach regardless of which driver happens to tolerate what.

3. **MongoDB: three compounding issues, each isolated in turn rather than guessed at together.**
   - Self-generated Mongo password (`openssl rand -base64`) could contain URL-breaking characters — pre-emptively regenerated with `openssl rand -hex` instead, sidestepping the whole class of problem.
   - Catalog's actual crash (`context deadline exceeded`, topology `Type: Unknown`) turned out to be neither a networking nor a credentials problem — proven by two isolated tests (an unauthenticated `ping`, then the real authenticated URI, both via a disposable `mongosh` pod) before touching any code. The real cause, found by reading Catalog's actual Go source: it calls `client.Ping(ctx, readpref.Primary())` — a replica-set concept — against a genuine standalone MongoDB with no `directConnection=true` hint, so the driver's topology monitor never resolved past "Unknown." **Fix**: added `directConnection=true` to the connection string.
   - After that fix, a *new* error appeared (`username required if URI contains user info`) — caused by referencing `$MONGO_USER`/`$MONGO_PASS` shell variables that had gone empty after switching terminal tabs (same root cause as the earlier `klearn: command not found` moment, but silent this time — an unset shell variable expands to nothing rather than erroring, quietly building a malformed secret). **Fix**: re-derive the variables fresh in the current session before reusing them; general lesson — shell variables never survive a new tab/session, only sourced files (like `.zshrc` aliases) do.

**Current state**: `kafka`, `mongodb`, `auth`, `catalog`, `payment`, `notification` all `Running` cleanly in the `ecommerce` namespace.

---

## Phase 7 — Remaining backend services (Cart, Order, Inventory)

Rebuilt the remaining 6 images multi-arch (same fix as Phase 6 bug #1), then deployed `infra/k8s/{cart,order,inventory}.yaml` — Cart (no secrets needed, Redis has no AUTH by design; connects to Catalog by in-cluster DNS name), Order and Inventory (using their composed `-db-url` secrets, same pattern as before).

### Real issues hit this phase (one environmental, two genuine bugs)

1. **A day passed between sessions, and the security group locked itself out.** `kubectl` started timing out entirely. Root cause: `allowed_admin_cidr` was pinned to a specific IP, and that IP — *your* laptop's public IP, assigned by your ISP, completely unrelated to AWS or the cluster's own Elastic IP — had changed overnight (normal behavior for a dynamic residential/mobile IP). The control plane's Elastic IP itself never changed; nothing on the AWS side was affected. **Fix**: updated `allowed_admin_cidr` in `variables.tf` to the new IP, `terraform apply` (in-place update, 2 resources, no disruption). Worth expecting this to recur — the variable's own comment already flagged it as "the first thing to check."

2. **Catalog was stuck in a 22-hour, 264-restart crash loop** with the same MongoDB "context deadline exceeded" error the `directConnection=true` fix was supposed to have resolved. Root-caused as most likely a transient, node-specific issue: a fresh pod, identical image/config, started cleanly on a *different* worker node with zero restarts. Not fully proven, but strong circumstantial evidence (same everything, different node, immediate success) pointed at something isolated to the one node rather than a real code/config defect — treated accordingly rather than chasing a phantom fix.

3. **Order genuinely could not reach RDS — a real, fixable bug**, not transient. Comparing its connection string against Auth's and Payment's (both healthy against the same RDS instance) surfaced one clear difference: Order's `DATABASE_URL` carried `sslmode=disable`, inherited unchanged from the service's own `.env.example` default (written for a local Docker Compose Postgres, never revisited for a real RDS target). RDS expects/prefers SSL; explicitly refusing it produces a silent hang rather than a clean rejection — matching the observed timeout exactly. **Fix**: rebuilt `order-db-url` without the `sslmode` parameter, matching Auth/Payment. Restart count dropped to 0 immediately after.

**Current state**: all 7 backend services (`auth`, `cart`, `catalog`, `inventory`, `notification`, `order`, `payment`) plus infra (`kafka`, `mongodb`) — 9 pods, all `Running`, all `0` restarts.

---

## Phase 8 — Gateway deployment and a real cross-node networking bug

Deployed `infra/k8s/gateway.yaml` (env: 5 backend service URLs, JWT_SECRET from `app-shared-secrets`, rate-limit config, `RATE_LIMIT_REDIS_URL` deliberately left unset — correct only for a single replica; must be set to the ElastiCache endpoint if ever scaled beyond one). The pod itself came up `Running` cleanly on the first try. Its `/readyz` endpoint, however, reported all four backend dependencies "unreachable" — this took real, multi-step diagnosis to get to the bottom of, and turned out to be the most significant infrastructure bug hit in this whole build.

### Diagnosis, in order

1. **First read**: `/readyz` returned a 503 after a ~2s timeout, backend services all reported unreachable. Gateway's own logs showed nothing more specific than the timeout itself.
2. **Ruled out "the backend pods are actually down"** — `kubectl get pods` showed all of them `Running`, `0` restarts.
3. **Ruled out plain network unreachability** — a basic ping-style test between pods succeeded.
4. **Found the real symptom**: a DNS lookup from an unrelated pod for a backend service's name (e.g. `auth`) failed outright — `wget: bad address 'auth:4001'`. Not a slow response, not an app-level error — the cluster's internal DNS resolution itself was failing for certain lookups.
5. **Checked CoreDNS** (the component that answers exactly this kind of lookup): pods healthy, `kube-dns` Service had valid Endpoints. Nothing obviously wrong there.
6. **Checked Calico** (the CNI providing pod networking): all `calico-system` components healthy.
7. **Restarted `calico-node` on the suspect node and recreated the affected pod** — neither fixed it, ruling out "just a stuck agent."
8. **Tested a raw IP connection straight to CoreDNS's own pod IP**, bypassing DNS name resolution entirely — this *also* timed out. This was the key clue: the problem wasn't DNS specifically, it was something breaking traffic between pods on different nodes, and DNS lookups were simply the first place it became visible (CoreDNS runs on the control-plane node; most of the other early "working" checks had — by coincidence — always been between two pods that happened to land on the *same* node).
9. **Noticed the pattern**: every confirmed-working interaction so far had actually been same-node pod traffic; every confirmed-failing one was cross-node. That pointed at something specific to inter-node traffic itself, not DNS, not Calico's control plane, not the app.
10. **Root cause identified**: AWS enables `source_dest_check` on every EC2 network interface by default — it silently drops any packet that isn't addressed to the instance's own IP. Calico's overlay network (VXLAN) works by wrapping one node's pod traffic inside a packet addressed to *another node's own IP*, then unwrapping it on arrival. From AWS's perspective this looks exactly like the instance forwarding traffic that isn't "really" for it — so it was being dropped at the network-interface level, invisible to Kubernetes, Calico, and the app entirely.
11. **Confirmed directly**, not just inferred: `aws ec2 describe-instances --query '...SourceDestCheck'` returned `true` on all three instances.

### Fix

Added `source_dest_check = false` to all three `aws_instance` resources in `infra/terraform/ec2.tf` (control plane and both workers), applied via Terraform — **3 changed, 0 destroyed**, a clean in-place update with no downtime, consistent with every other in-place change made so far in this project.

### Verification

Retested the exact case that had failed before — Gateway's `/readyz`, called from a pod on worker-0, checking backend services including Catalog/Order/Inventory on the other worker node. Result: `{"status":"ready"}`.

(One red herring hit *during* this specific retest, worth noting since it looked alarming at first: testing via `wget http://localhost:8080/readyz` from inside the Gateway pod itself returned "connection refused," which looked like the app had crashed. It hadn't — the app's logs showed it had bound explicitly to its IPv4 loopback address, and busybox's `wget` was resolving `localhost` to the IPv6 loopback `::1` first, which nothing was listening on. Using the explicit IPv4 address, `http://127.0.0.1:8080/readyz`, resolved it instantly. Unrelated to the real networking bug — just a naming coincidence that surfaced at the same time.)

**Retroactive insight**: this also fully explains Phase 7's earlier "Catalog stuck in a 22-hour crash loop, fixed by itself on a different node" — that pod's fresh, working instance had simply landed on the same node as MongoDB by chance, sidestepping the same cross-node bug rather than the original issue having actually been resolved.

**Current state**: all 8 targeted backend/gateway pods (`auth`, `cart`, `catalog`, `gateway`, `inventory`, `notification`, `order`, `payment`) plus infra (`kafka`, `mongodb`) — 10 pods, all `Running`, all `0` restarts, and cross-node pod networking confirmed genuinely working end-to-end.

---

## Phase 9 — Frontend, Admin, and external exposure

The flagged risk from Phase 8's "next steps" turned out to be real: both
`frontend/Dockerfile` and `admin/Dockerfile` default `ARG
NEXT_PUBLIC_API_URL=http://localhost:8080/api` unless overridden with
`--build-arg` at build time. Next.js inlines `NEXT_PUBLIC_*` variables
directly into the client-side JavaScript bundle at `npm run build` — they
are **not** read at container runtime like a normal environment variable,
so setting them in the Kubernetes manifest would have had zero effect.
The images already pushed to Docker Hub (`bigstan00/ecommerce-storefront`,
`bigstan00/ecommerce-admin`) were built for local Docker Compose, so this
default was almost certainly what was actually baked in.

**This created a real ordering constraint**, not just a fix to apply:
Frontend/Admin need a stable external URL baked in *before* they're
built, but they can't get one until Gateway is actually exposed outside
the cluster. Solved by exposing Gateway first, on a **pinned** NodePort
rather than a random one — `kubectl`/Kubernetes would otherwise assign
whichever free port happens to be available in `30000-32767`, which
would silently change every time the Service is recreated and break
whatever URL had been baked into an already-built image.

**Step 1 — `infra/k8s/gateway.yaml`**: Service changed from the default
`ClusterIP` to `type: NodePort`, with `nodePort: 30080` explicitly
pinned. Applied cleanly (`service/gateway configured`). Verified
reachable from outside the cluster entirely — not just from another pod
— via `curl http://13.63.120.61:30080/readyz` from the laptop, which
returned `{"status":"ready"}`. `13.63.120.61` is the control plane's
Elastic IP specifically (not a worker's ordinary public IP), chosen
because it's the one address in this cluster guaranteed not to change on
a stop/start — the same reasoning as Phase 2's original EIP decision.

**Step 2 — rebuilt Frontend and Admin**, multi-arch (same fix as Phase
6/7), this time with the build-arg actually set:
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=http://13.63.120.61:30080/api \
  -t bigstan00/ecommerce-storefront:latest --push ./frontend

docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg NEXT_PUBLIC_API_URL=http://13.63.120.61:30080/api \
  -t bigstan00/ecommerce-admin:latest --push ./admin
```

**Step 3 — new manifests** `infra/k8s/frontend.yaml` and `admin.yaml`,
same Deployment + NodePort Service pattern as Gateway. No
`NEXT_PUBLIC_API_URL` set in either manifest — deliberately, since it's
already compiled into the image and a runtime env var here would do
nothing; documented as a comment directly in both files as a trap for
future-me. Pinned `nodePort: 30090` (frontend) and `30091` (admin).
Deployed cleanly — both pods `Running`, `0` restarts, and (by chance)
landed on different nodes from each other, an incidental extra
confirmation that Phase 8's cross-node networking fix is holding.

**Verified in an actual browser, not just `curl`:**
- Storefront (`http://13.63.120.61:30090`) — page rendered fully, zero
  console errors, all requests `200 OK`. Showed "No products found — the
  catalog is empty right now," which is the **correct** state (no
  product data has been seeded into Catalog's database yet) rather than
  a connection failure — confirming the app is genuinely talking to the
  Gateway successfully, just against an empty dataset.
- Admin (`http://13.63.120.61:30091`) — correctly showed its
  unauthenticated login gate ("You're not signed in — log in with the
  admin token"), zero console errors.

**Current state**: the full application is now reachable end-to-end from
outside the cluster — Storefront, Admin, and the Gateway API all
externally accessible, sitting on top of a self-managed `kubeadm`
cluster with genuinely-verified cross-node pod networking, managed
Postgres/Redis, and in-cluster Kafka/MongoDB.

---

## Phase 10 — Real persistent storage for Kafka and MongoDB

Both had been running as a plain `Deployment` with `emptyDir` storage
since Phase 6/7 — explicitly flagged at the time as a learning-cluster
shortcut, not a silent gap. `emptyDir` is scratch space tied to the
pod's own lifetime: it's wiped the instant the pod restarts or moves to
a different node. Fixed properly this phase, in the order the pieces
actually depend on each other:

**1. Grant the nodes AWS permission to manage EBS disks** — new
`infra/terraform/iam.tf`: an `aws_iam_role` (trusted by `ec2.amazonaws.com`)
with AWS's own managed `AmazonEBSCSIDriverPolicy` attached, wrapped in an
`aws_iam_instance_profile`. Attached to all three EC2 instances by
adding `iam_instance_profile` to both `aws_instance` blocks in
`ec2.tf`. On EKS this kind of thing is automatic via IRSA (IAM Roles for
Service Accounts, which needs an OIDC provider wired into the cluster);
on a self-managed cluster, granting the permission at the node/instance
level is the simplest real equivalent — the trade-off, noted directly in
the Terraform comments, is that every pod on the node technically shares
this AWS access, not just the storage driver specifically. A genuine
multi-tenant production cluster would want IRSA or a tighter boundary;
acceptable here. **Applied cleanly: 3 added, 3 changed, 0 destroyed** —
the 3 changes were the instance-profile attachment, done in-place with
no instance restart (same pattern as every other Terraform change this
project).

**2. Installed the AWS EBS CSI driver** — the actual software that
translates a Kubernetes "give me a disk" request into real AWS EBS API
calls (create/attach/detach volumes). Nothing like this exists on a
self-managed cluster by default; EKS bundles it in, we don't get it for
free. Verified current stable release (`v1.63.0` / branch `release-1.63`)
rather than assumed, then installed via its official kustomize overlay:
```bash
kubectl apply -k "github.com/kubernetes-sigs/aws-ebs-csi-driver/deploy/kubernetes/overlays/stable/?ref=release-1.63"
```
Came up clean: a 2-replica controller Deployment plus a node-agent
DaemonSet on all 3 nodes, all healthy on the first try — the IAM
permissions from step 1 were picked up automatically via the node's
instance metadata, no extra credentials to configure.

**3. Created a `StorageClass`** (`infra/k8s/storageclass.yaml`) —
`ebs-gp3`, provisioner `ebs.csi.aws.com`, `volumeBindingMode:
WaitForFirstConsumer`. That binding mode matters mechanically: EBS
volumes are locked to a single Availability Zone, and this cluster's two
workers are deliberately spread across two AZs. `WaitForFirstConsumer`
delays actually creating the disk until Kubernetes already knows which
node (and therefore which AZ) the pod landed on; the alternative
(`Immediate`) can create a volume in the wrong AZ before scheduling
happens, leaving the pod stuck `Pending` forever.

**4. Converted both `kafka.yaml` and `mongodb.yaml`** from `Deployment`
to `StatefulSet`, replacing the `emptyDir` volume with a
`volumeClaimTemplates` entry (`storageClassName: ebs-gp3`, 5Gi each).
Also changed both Services to headless (`clusterIP: None`) — required
for a `StatefulSet` to give its pod a stable DNS identity, and a field
that can't be edited on an existing Service (`clusterIP` is immutable
once set), so this had to be a delete-and-recreate rather than an
in-place `apply`. **Explicitly flagged and explained to the user before
running it**: this meant a real, brief restart for both, with whatever
was currently in the old `emptyDir` (an empty catalog, no real orders)
being lost — acceptable, since that data was already scratch by
definition, and the other services reconnect automatically once the new
pods are up, no code changes needed on their end.

```bash
kubectl delete deployment kafka mongodb -n ecommerce
kubectl delete svc kafka mongodb -n ecommerce
kubectl apply -f infra/k8s/kafka.yaml
kubectl apply -f infra/k8s/mongodb.yaml
```

Both PVCs bound to real EBS volumes within seconds
(`kafka-data-kafka-0`, `mongo-data-mongodb-0`, 5Gi each, `Bound`), both
pods `Running` cleanly.

**5. Verified real persistence, not just trusted the mechanism**:
wrote a test document into MongoDB (`persistence_test.proof`, a
timestamped record), noted its `ObjectId`, then fully **deleted** the
pod (`kubectl delete pod mongodb-0`, not just a container restart) and
waited for the `StatefulSet` controller to recreate it. Queried again
once the fresh pod was `Running` — **the exact same `ObjectId` and
document were still there.** This is the proof that actually matters:
the data lived on the EBS volume independently of the pod's lifecycle,
which is precisely what `Deployment`+`emptyDir` could never provide.

**One real bug hit mid-phase, unrelated to storage**: `kubectl` access
timed out partway through — the now-familiar dynamic-IP issue (laptop's
public IP had changed again). Same fix as every prior occurrence:
checked `curl checkip.amazonaws.com`, updated `allowed_admin_cidr` in
`variables.tf`, `terraform apply` (in-place, 1 resource). Confirmed once
more this is a recurring, expected nuisance on a residential/mobile
connection, not an infrastructure problem — worth continuing to expect
it going forward.

**Current state**: Kafka and MongoDB both run as `StatefulSet`s backed
by real 5Gi EBS `gp3` volumes, survive pod deletion/rescheduling with
data intact, verified end-to-end rather than assumed. Every other
service in the cluster required zero changes — they only ever knew
these as `kafka:9092` / `mongodb:27017`, and that DNS contract didn't
change.

## Next steps (not yet done)

1. Seed some product data into Catalog so the Storefront has something to actually display (currently empty, correctly).
2. CI/CD (GitHub Actions), observability stack (Prometheus/Grafana + tracing backend), and hardening (RBAC, NetworkPolicies, resource limits, HA control plane, private subnets + NAT, per-role security groups, IRSA instead of node-wide IAM) — later phases, not started yet.
