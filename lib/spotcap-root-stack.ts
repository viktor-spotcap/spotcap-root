import * as cdk from '@aws-cdk/core';
import * as ec2 from '@aws-cdk/aws-ec2';
import ecs = require('@aws-cdk/aws-ecs');
import iam = require('@aws-cdk/aws-iam');
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');
import { GocardlessService } from './gocardless-service';
import { AccessManagementService } from './access-management-service';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';

export class SpotcapRootStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "production-network-public", { vpcId: "vpc-63b9a20a" });

    const spotcapRootCluster = new ecs.Cluster(this, 'Spotcap-Root', { vpc });

    const execRole = new iam.Role(this, 'SpotcapRootTaskExecutionRole-', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    })
    execRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, "AmazonECSTaskExecutionRolePolicy", 'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'))

    const containerTaskRole = new iam.Role(this, 'SpotcapRootTaskRole-', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    })

    containerTaskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
    containerTaskRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'ReadProductionS3', 'arn:aws:iam::895246776674:policy/ReadProductionS3'));
    containerTaskRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'KMSDecrypt', 'arn:aws:iam::895246776674:policy/KMSDecrypt'));

    const lb = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
    });

    lb.addRedirect({
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      sourcePort: 80,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
      targetPort: 443,
    });

    const listener = lb.addListener('PublicListener', {
      port: 443,
      open: true,
      certificates: [
        elbv2.ListenerCertificate.fromArn("arn:aws:acm:eu-central-1:895246776674:certificate/a1052080-2b55-4f91-8076-6fa3ba92598e")
      ]
    });

    listener.addAction('Default', {
      action: elbv2.ListenerAction.fixedResponse(404)
    });

    const hostedZone = route53.HostedZone.fromLookup(this, 'spotcap.com', {
      domainName: 'spotcap.com',
    });

    const gocardlessService = new GocardlessService(
      this,
      spotcapRootCluster,
      execRole,
      containerTaskRole,
      listener,
      hostedZone
    );

    const accessManagementService = new AccessManagementService(
      this,
      spotcapRootCluster,
      execRole,
      containerTaskRole,
      listener,
      hostedZone
    )

    new cdk.CfnOutput(this, 'LoadBalancerDNS', { value: lb.loadBalancerDnsName, });

  }
}
