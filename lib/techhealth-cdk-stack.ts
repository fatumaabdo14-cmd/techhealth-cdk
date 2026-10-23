import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';




export class TechhealthCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    // vpc: 2 AZs, public + private subnets, no NAT (cost constraints)
    const vpc = new ec2.Vpc(this, 'TechHealthVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Security group for EC2
    const ec2SG = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      description: 'Allow web traffic and SSH from my IP',
      allowAllOutbound: true,
    });
    ec2SG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from anywhere');
    ec2SG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS traffic from anywhere');
    ec2SG.addIngressRule(
      ec2.Peer.ipv4('76.168.96.40/32'),
      ec2.Port.tcp(22),
      'Allow SSH from my IP',
    );

    // Security group for RDS
    const rdsSG = new ec2.SecurityGroup(this, 'RDSSecurityGroup', {
      vpc,
      description: 'Allow MySQL traffic from EC2',
      allowAllOutbound: false,
    });
    rdsSG.addIngressRule(ec2SG, ec2.Port.tcp(3306), 'Allow MySQL traffic from EC2 only');

    // IAM role for EC2: lets us connect with SSM (no SSH keys needed)
    const ec2Role = new iam.Role(this, 'EC2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    ec2Role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
    );

    // EC2 instance in a public subnet
    const instance = new ec2.Instance(this, 'TechHealthEC2', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType('t3.micro'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: ec2SG,
      role: ec2Role,
    });

    // RDS MySQL in the private subnet (no internet access)
     const db = new rds.DatabaseInstance(this, 'TechHealthDb', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.of('8.4.9', '8.4') }),
      instanceType: new ec2.InstanceType('t3.micro'),
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSG],
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
      databaseName: 'techhealth',
      allocatedStorage: 20,
      multiAz: false,
      publiclyAccessible: false,
      storageEncrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });


    // Let EC2 read the database password
    db.secret?.grantRead(ec2Role);

    // Output the instance ID after deployment for testing.
    new cdk.CfnOutput(this, 'EC2PublicIp', { value: instance.instancePublicIp });
    
    new cdk.CfnOutput(this, 'RdsEndpoint', { value: db.dbInstanceEndpointAddress });
    new cdk.CfnOutput(this, 'DbSecretName', { value: db.secret?.secretName ?? 'none' });
  }
}