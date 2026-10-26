# TechHealth Patient Portal — AWS Infrastructure (CDK)

Infrastructure as Code for migrating the TechHealth Inc. patient portal to AWS, built with **AWS CDK (TypeScript)**. The stack provisions a segmented network, an application server, and a private, encrypted MySQL database, with access designed around least privilege.

| | |
|---|---|
| **IaC** | AWS CDK v2 (TypeScript) |
| **Region** | us-west-1 (2 Availability Zones) |
| **Services** | VPC · EC2 · RDS for MySQL · Secrets Manager · IAM · Systems Manager |

---

## Architecture

![TechHealth architecture diagram](diagram.png)

### Network layout

| Subnet | CIDR | Type | Purpose |
|---|---|---|---|
| Public subnet (AZ-1) | 10.0.0.0/24 | Public | Application server (EC2) |
| Public subnet (AZ-2) | 10.0.1.0/24 | Public | Reserved for scale-out |
| Private subnet (AZ-1) | 10.0.2.0/24 | Private isolated | Database (RDS primary) |
| Private subnet (AZ-2) | 10.0.3.0/24 | Private isolated | Database subnet group / planned Multi-AZ standby |

### Resources

| Resource | Configuration |
|---|---|
| VPC | 10.0.0.0/16, 2 AZs, internet gateway, **no NAT gateway** |
| EC2 | t3.micro, Amazon Linux 2023, public subnet |
| RDS | MySQL 8.4, db.t3.micro, 20 GB, encrypted, private subnet |
| Secrets Manager | Auto-generated database credentials |
| IAM role | Attached to EC2: Session Manager access + read the DB secret |

---

## Security design

| Control | How it is implemented |
|---|---|
| Database isolation | RDS runs in private isolated subnets with public access disabled. No route to or from the internet. |
| Least-privilege network access | RDS security group allows port **3306 only from the EC2 security group**, not from an IP range. RDS outbound traffic is disabled. |
| Restricted administration | SSH (22) limited to a single administrator IP. Session Manager enabled, so access works without SSH keys. |
| No hardcoded credentials | DB password generated at deploy time and stored in Secrets Manager. The EC2 role can read that one secret only. |
| Encryption at rest | RDS storage encryption enabled. |
| Instance identity | EC2 uses an IAM role (temporary credentials), never access keys. |

### Security group rules

| Security group | Inbound | Source |
|---|---|---|
| EC2-SG | HTTP 80, HTTPS 443 | 0.0.0.0/0 |
| EC2-SG | SSH 22 | Administrator IP (/32) only |
| RDS-SG | MySQL 3306 | EC2-SG only |

---

## Design decisions and tradeoffs

| Decision | Reason | Production path |
|---|---|---|
| No NAT gateway | Saves ~$32/month per AZ; the database never needs internet access | Add NAT or VPC endpoints if private workloads need outbound access |
| Single EC2 instance | Keeps the dev environment cost-efficient | Application Load Balancer + Auto Scaling group across both AZs |
| Single-AZ RDS | Network is already Multi-AZ ready; standby not needed in dev | Set `multiAz: true` for automatic failover |
| `RemovalPolicy.DESTROY` | `cdk destroy` removes everything cleanly, no leftover snapshots | Use `SNAPSHOT` or `RETAIN` with deletion protection |

---

## Deploy

**Prerequisites:** Node.js, AWS CLI configured, AWS CDK v2

```bash
npm install
cdk bootstrap     # first time per account/region
cdk synth         # generate CloudFormation
cdk diff          # preview changes
cdk deploy
```

### Stack outputs

| Output | Description |
|---|---|
| `EC2PublicIp` | Public IP of the application server |
| `RdsEndpoint` | Private endpoint of the MySQL database |
| `DbSecretName` | Secrets Manager secret holding the DB credentials |

### Connect to the database from EC2

```bash
sudo dnf install -y mariadb105
mysql -h <RdsEndpoint> -u admin -p
```

Password: Secrets Manager → `<DbSecretName>` → Retrieve secret value.

---

## Tear down

```bash
cdk destroy
```

The environment is destroyed when not in use and redeployed on demand. The code is the source of truth.

---

## Verified in a live deployment

| Check | Result |
|---|---|
| CloudFormation stack | `CREATE_COMPLETE` |
| EC2 instance | Running in public subnet |
| RDS instance | Available, not publicly accessible |
| Subnets | Public and private across two AZs |
| RDS security group | Inbound 3306 from EC2 security group only |

---

## Roadmap

| Next step | Benefit |
|---|---|
| ALB + Auto Scaling group, instances in private subnets | High availability, no public instances |
| HTTPS with ACM certificate | Encrypted traffic in transit |
| Multi-AZ RDS + backup retention | Automatic database failover |
| Remove SSH rule (Session Manager only) | Smaller attack surface |
| CloudWatch alarms | Alerts on CPU, connections, storage |
| GitHub Actions CI/CD | `cdk diff` on pull requests, `cdk deploy` on merge |

---

## Project structure

```
bin/techhealth-cdk.ts          # App entry point
lib/techhealth-cdk-stack.ts    # VPC, security groups, IAM role, EC2, RDS
test/techhealth-cdk.test.ts    # Stack tests
diagram.png                    # Architecture diagram
cdk.json                       # CDK configuration

```
## The problem
TechHealth, a healthcare case study, ran its patient portal on AWS resources created manually in the console five years ago. There was no version control or audit trail, rebuilding the environment was error-prone, and the database holding patient data was publicly reachable.

## What I built
The full environment as Infrastructure as Code with AWS CDK (TypeScript): a two-AZ VPC, an application server in a public subnet, and an encrypted MySQL database in isolated private subnets with no route to the internet. Database credentials are generated at deploy time and stored in Secrets Manager.

## Key decisions
| Decision | Chosen over | Why |
|---|---|---|
| RDS security group allows 3306 only from the EC2 security group | IP-based rules | Access follows the resource, not an address. Nothing else can reach the database. |
| No NAT Gateway | NAT Gateway per AZ | The database never needs outbound internet. Saves ~$64/month across two AZs. |

## What broke
The first deploy failed because the EC2 instance type was not Free Tier eligible for this account and region. Instead of guessing, I queried AWS with `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`, selected t3.micro from the returned list, and redeployed successfully.

## Result
- Database with zero public exposure
- ~$64/month saved by avoiding NAT Gateways
- Entire environment deploys and tears down with one command

## Cost considerations
- EC2 t3.micro and RDS db.t3.micro: Free Tier eligible
- No NAT Gateway: ~$32/month saved per AZ
- Single-AZ RDS: avoids doubling database cost in dev
- Secrets Manager: ~$0.40/month per secret
- Environment destroyed when not in use

## Lessons learned
| Issue | Takeaway |
|---|---|
| `cdk bootstrap` failed on leftover resources | Stale bootstrap roles and buckets (`hnb659fds`) must be cleaned up per region before re-bootstrapping |
| Instance type not Free Tier eligible | Eligibility varies by account and region; verify with `describe-instance-types` |
| RDS engine version rejected | Pin an exact engine version (MySQL 8.4.9) |
| db.t2.micro rejected for MySQL 8.4 | Use db.t3.micro for current MySQL versions |
| Unencrypted storage flagged | Enable `storageEncrypted` for any workload holding patient data |

---

**Author:** Fatuma Abdo · [Meduim] https://medium.com/@fatumaabdo14/rebuilding-a-healthcare-patient-portal-on-aws-with-cdk-0d8014d3e4d4
