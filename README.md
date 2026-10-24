TechHealth Patient Portal — AWS Infrastructure (CDK)

Infrastructure as Code for migrating the TechHealth Inc. patient portal from a manually built environment to AWS, defined in AWS CDK (TypeScript). The stack provisions a segmented network, an application server, and a private, encrypted MySQL database, with access controls designed around least privilege.

Stack: AWS CDK · TypeScript · Amazon VPC · EC2 · RDS for MySQL · Secrets Manager · IAM · Systems Manager
diagram.png

Network layout
Subnet	CIDR	Type	Purpose
publicSubnet1	10.0.0.0/24	Public	Application server
publicSubnet2	10.0.1.0/24	Public	Second AZ
privateSubnet1	10.0.2.0/24	Private isolated	Database
privateSubnet2	10.0.3.0/24	Private isolated	Database (RDS subnet groups require 2 AZs)
Security design
Control	Implementation
Database isolation	RDS runs in PRIVATE_ISOLATED subnets with publiclyAccessible: false; there is no route to or from the internet.
Least-privilege network access	The RDS security group allows port 3306 only from the EC2 security group (SG-to-SG reference), not from any CIDR range. RDS outbound traffic is disabled.
Restricted administration	SSH (22) is limited to a single /32 administrator IP. Session Manager is enabled through the instance role, so access works without open ports or SSH keys.
No hardcoded credentials	Database credentials are generated at deploy time and stored in Secrets Manager. The EC2 role is granted read access to that one secret only.
Encryption at rest	storageEncrypted: true on the RDS instance.
Instance identity	EC2 uses an IAM role (temporary credentials), not access keys.
Design decisions and tradeoffs
No NAT gateway. A NAT gateway costs roughly $32/month per AZ. The database does not need internet access, so the private subnets are PRIVATE_ISOLATED. Tradeoff: resources in those subnets cannot reach the internet for patches; RDS is managed by AWS, so this does not apply to it.
Single-AZ RDS. multiAz: false keeps this environment cost-efficient for development. For production, enable Multi-AZ for automatic failover.
Single EC2 instance in a public subnet. Simple and inexpensive for this stage. A production design would put an Application Load Balancer in the public subnets and move instances into private subnets behind an Auto Scaling group.
RemovalPolicy.DESTROY and no deletion protection. Intentional for a dev environment so cdk destroy removes everything cleanly and leaves no billable snapshots. Production databases should use SNAPSHOT or RETAIN with deletion protection enabled.
Deploy

Prerequisites: Node.js, AWS CLI configured, AWS CDK v2.

bash
npm install
cdk bootstrap            # first time per account/region
cdk synth                # review the generated CloudFormation
cdk diff                 # preview changes
cdk deploy

Stack outputs:

Output	Description
EC2PublicIp	Public IP of the application server
RdsEndpoint	Private endpoint of the MySQL database
DbSecretName	Secrets Manager secret holding the DB credentials
Connect to the database from EC2
bash
# On the instance (via Session Manager)
sudo dnf install -y mariadb105
mysql -h <RdsEndpoint> -u admin -p
# Password: Secrets Manager → <DbSecretName> → Retrieve secret value
Tear down
bash
cdk destroy

The environment is destroyed when not in use and redeployed on demand; the code is the source of truth.

Verification

Screenshots from a live deployment are in screenshots/:

CloudFormation stack resources
EC2 instance running in the public subnet
RDS instance — available, not publicly accessible
VPC subnets across two availability zones
RDS security group — inbound 3306 from the EC2 security group only
Roadmap
Application Load Balancer + Auto Scaling group, with instances moved to private subnets
HTTPS with an ACM certificate on the load balancer
Multi-AZ RDS and automated backup retention for production
Remove the SSH rule entirely in favor of Session Manager
CloudWatch alarms for CPU, database connections, and free storage
CI/CD with GitHub Actions running cdk diff on pull requests and cdk deploy on merge
Project structure
bin/techhealth-cdk.ts          # App entry point
lib/techhealth-cdk-stack.ts    # VPC, security groups, IAM role, EC2, RDS
test/techhealth-cdk.test.ts    # Stack tests
cdk.json                       # CDK configuration

Author: Fatuma Abdo · LinkedIn
