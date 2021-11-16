import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import { SpotcapService } from './spotcap-service';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';

export class AccessManagementService implements SpotcapService {

    readonly service: ecs.BaseService;

    constructor(
        scope: cdk.Construct,
        cluster: ecs.Cluster,
        execRole: iam.IRole,
        containerTaskRole: iam.IRole,
        listener: elbv2.ApplicationListener,
        hostedZone: route53.IHostedZone
    ) {

        const taskDfinition = new ecs.FargateTaskDefinition(scope, "AccessManagement-Task-Definition", {
            memoryLimitMiB: 1024,
            cpu: 512,
            executionRole: execRole,
            taskRole: containerTaskRole
        });

        const logging = new ecs.AwsLogDriver({
            streamPrefix: "access-management"
        });

        taskDfinition.addContainer("api", {
            image: ecs.ContainerImage.fromRegistry("895246776674.dkr.ecr.eu-central-1.amazonaws.com/access-management-api:0bc3dc26-api"),
            logging: logging,
            portMappings: [{
                containerPort: 8185,
                hostPort: 8185,
                protocol: ecs.Protocol.TCP,
            },
            {
                containerPort: 9999,
                hostPort: 9999,
                protocol: ecs.Protocol.TCP,
            },
            ],
            environment: {
                "ENVIRONMENT": "production",
                "SECRETS_URL": "s3://elasticbeanstalk-eu-central-1-895246776674/api-access-management-production/secrets_production.kms --region eu-central-1"
            }
            ,
        })

        taskDfinition.addContainer("nginx", {
            image: ecs.ContainerImage.fromRegistry("895246776674.dkr.ecr.eu-central-1.amazonaws.com/access-management-api:root-migration-nginx"),
            logging: logging,
            portMappings: [{
                containerPort: 80,
                hostPort: 80,
                protocol: ecs.Protocol.TCP
            }],
            environment: {
                "ENVIRONMENT": "production"
            }
        })

        this.service = new ecs.FargateService(scope, 'AccessManagement', {
            cluster: cluster,
            taskDefinition: taskDfinition
        });

        listener.addTargets('AccessManagementTarget', {
            port: 80,
            priority: 2,
            targetGroupName: 'AccessManagementTarget',
            conditions: [
                elbv2.ListenerCondition.hostHeaders(['access-management.spotcap.com'])
            ],
            targets: [
                this.service.loadBalancerTarget({
                    containerName: 'nginx',
                    containerPort: 80
                })
            ],
            healthCheck: {
                interval: cdk.Duration.seconds(60),
                path: "/health",
                port: "80",
                timeout: cdk.Duration.seconds(5)
            }
        });
        new route53.ARecord(scope, 'AccessManagementAlias', {
            zone: hostedZone,
            recordName: 'access-management.spotcap.com',
            target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(listener.loadBalancer))
        });
    }
}