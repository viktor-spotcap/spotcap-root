import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as iam from '@aws-cdk/aws-iam';
import * as elbv2 from '@aws-cdk/aws-elasticloadbalancingv2';
import { SpotcapService } from './spotcap-service';
import * as route53 from '@aws-cdk/aws-route53';
import * as targets from '@aws-cdk/aws-route53-targets';

export class GocardlessService implements SpotcapService {

    readonly service: ecs.BaseService;

    constructor(
        scope: cdk.Construct,
        cluster: ecs.Cluster,
        execRole: iam.IRole,
        containerTaskRole: iam.IRole,
        listener: elbv2.ApplicationListener,
        hostedZone: route53.IHostedZone
    ) {

        const gocardlessTaskDfinition = new ecs.FargateTaskDefinition(scope, "Gocardless-Task-Definition", {
            memoryLimitMiB: 1024,
            cpu: 512,
            executionRole: execRole,
            taskRole: containerTaskRole
        });

        const gocardlessLogging = new ecs.AwsLogDriver({
            streamPrefix: "gocardless"
        });

        gocardlessTaskDfinition.addContainer("api", {
            image: ecs.ContainerImage.fromRegistry("895246776674.dkr.ecr.eu-central-1.amazonaws.com/production:120-1c25fd61-api"),
            logging: gocardlessLogging,
            portMappings: [{
                containerPort: 8085,
                hostPort: 8085,
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
                "SECRETS_URL": "s3://elasticbeanstalk-eu-central-1-895246776674/api-payment-gocardless-production/secrets_production.kms --region eu-central-1"
            }
            ,
        })

        gocardlessTaskDfinition.addContainer("nginx", {
            image: ecs.ContainerImage.fromRegistry("895246776674.dkr.ecr.eu-central-1.amazonaws.com/payment-gocardless-api:root-migration-nginx"),
            logging: gocardlessLogging,
            portMappings: [{
                containerPort: 80,
                hostPort: 80,
                protocol: ecs.Protocol.TCP
            }],
            environment: {
                "ENVIRONMENT": "production"
            }
        })

        this.service = new ecs.FargateService(scope, 'Gocardless', {
            cluster: cluster,
            taskDefinition: gocardlessTaskDfinition
        });

        listener.addTargets('GocardlessTarget', {
            port: 80,
            priority: 1,
            conditions: [
                elbv2.ListenerCondition.hostHeaders(['payment-gocardless.spotcap.com'])
            ],
            targetGroupName: 'GocardlessTarget',
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
        new route53.ARecord(scope, 'GocardlessAlias', {
            zone: hostedZone,
            recordName: 'payment-gocardless.spotcap.com',
            target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(listener.loadBalancer))
        });
    }

}