import { aws_apigatewayv2, aws_dynamodb, aws_iam, aws_lambda, CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class LambdaPubsubStack extends Stack {
  private connectionDb: aws_dynamodb.Table
  private messageDb: aws_dynamodb.Table
  private websocketApi: aws_apigatewayv2.CfnApi

  private onConnectFunc: aws_lambda.Function
  private onDisconnectionFunc: aws_lambda.Function
  private onSubscribeFunc: aws_lambda.Function
  private onPublishFunc: aws_lambda.Function

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const region = "ap-northeast-1";
    const name = "pubsub";
    const stageName = "dev";

    /**
     * db
     */
    this.connectionDb = new aws_dynamodb.Table(this, `${stageName}-${name}-connection-db`, {
      tableName: `${stageName}-${name}-connection-db`,
      partitionKey: {
        name: 'topic',
        type: aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'connectionId',
        type: aws_dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'ttl',

      billingMode: aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.messageDb = new aws_dynamodb.Table(this, `${stageName}-${name}-message-db`, {
      tableName: `${stageName}-${name}-message-db`,
      partitionKey: {
        name: 'topic',
        type: aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'created_at',
        type: aws_dynamodb.AttributeType.NUMBER,
      },
      timeToLiveAttribute: 'ttl',

      billingMode: aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * api gateway
     */
    this.websocketApi = new aws_apigatewayv2.CfnApi(this, `${stageName}-${name}-websocket-api-gateway`, {
      name: `${stageName}-${name}`,
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });

    /**
     * websocket handler function
     */
     this.onConnectFunc = new aws_lambda.Function(this, `${stageName}-${name}-on-connect-func`, {
      code: new aws_lambda.AssetCode("./src"),
      handler: "handler/connect.handler",
      runtime: aws_lambda.Runtime.NODEJS_14_X,
      timeout: Duration.seconds(300),
      memorySize: 256,
      description: `${stageName}-${name} on connection func`,
    });
    this.onConnectFunc.grantInvoke(new aws_iam.ServicePrincipal("apigateway.amazonaws.com"));

    this.onDisconnectionFunc = new aws_lambda.Function(this, `${stageName}-${name}-on-disconnect-func`, {
      code: new aws_lambda.AssetCode("./src"),
      handler: "handler/disconnect.handler",
      runtime: aws_lambda.Runtime.NODEJS_14_X,
      timeout: Duration.seconds(300),
      memorySize: 256,
      description: `${stageName}-${name} on disconnect func`,
    });
    this.onDisconnectionFunc.grantInvoke(new aws_iam.ServicePrincipal("apigateway.amazonaws.com"));

    this.onSubscribeFunc = new aws_lambda.Function(this, `${stageName}-${name}-on-subscribe-func`, {
      code: new aws_lambda.AssetCode("./src"),
      handler: "handler/subscribe.handler",
      runtime: aws_lambda.Runtime.NODEJS_14_X,
      environment: {
        TABLE_NAME: this.connectionDb.tableName,
        MESSAGE_TABLE_NAME: this.messageDb.tableName,
      },
      timeout: Duration.seconds(300),
      memorySize: 256,
      description: `${stageName}-${name} on subscribe func`,
      initialPolicy: [
        new aws_iam.PolicyStatement({
          actions: [
            'execute-api:ManageConnections'
          ],
          resources: [
            `arn:aws:execute-api:${region}:${this.account}:${this.websocketApi.ref}/*`,
          ],
          effect: aws_iam.Effect.ALLOW,
        }),
      ],
    });
    this.connectionDb.grantWriteData(this.onSubscribeFunc);
    this.messageDb.grantReadData(this.onSubscribeFunc);
    this.onSubscribeFunc.grantInvoke(new aws_iam.ServicePrincipal("apigateway.amazonaws.com"));

    this.onPublishFunc = new aws_lambda.Function(this, `${stageName}-${name}-on-publish-func`, {
      code: new aws_lambda.AssetCode("./src"),
      handler: "handler/publish.handler",
      runtime: aws_lambda.Runtime.NODEJS_14_X,
      environment: {
        TABLE_NAME: this.connectionDb.tableName,
        MESSAGE_TABLE_NAME: this.messageDb.tableName,
      },
      timeout: Duration.seconds(300),
      memorySize: 256,
      description: `${stageName}-${name} on publish func`,
      initialPolicy: [
        new aws_iam.PolicyStatement({
          actions: [
            'execute-api:ManageConnections'
          ],
          resources: [
            `arn:aws:execute-api:${region}:${this.account}:${this.websocketApi.ref}/*`,
          ],
          effect: aws_iam.Effect.ALLOW,
        }),
      ],
    });
    this.connectionDb.grantReadWriteData(this.onPublishFunc);
    this.messageDb.grantReadWriteData(this.onPublishFunc);
    this.onPublishFunc.grantInvoke(new aws_iam.ServicePrincipal("apigateway.amazonaws.com"));

    /**
     * routing
     */

    // access role for the socket api to access the socket lambda
    const policy = new aws_iam.PolicyStatement({
      effect: aws_iam.Effect.ALLOW,
      resources: [
        this.onConnectFunc.functionArn,
        this.onDisconnectionFunc.functionArn,
        this.onSubscribeFunc.functionArn,
        this.onPublishFunc.functionArn,
      ],
      actions: ["lambda:InvokeFunction"]
    });
    const role = new aws_iam.Role(this, `${name}-iam-role`, {
      assumedBy: new aws_iam.ServicePrincipal("apigateway.amazonaws.com")
    });
    role.addToPolicy(policy);

    const onConnectionIntegration = new aws_apigatewayv2.CfnIntegration(this, `${stageName}-${name}-apigw-integration-on-connect`, {
      apiId: this.websocketApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.onConnectFunc.functionArn}/invocations`,
      credentialsArn: role.roleArn,
    });
    const onConnectionRoute = new aws_apigatewayv2.CfnRoute(this, `${stageName}-${name}-apigw-route-on-connect`, {
      apiId: this.websocketApi.ref,
      routeKey: "$connect",
      target: `integrations/${onConnectionIntegration.ref}`,
      authorizationType: "NONE",
    });

    const onDisconnectionIntegration = new aws_apigatewayv2.CfnIntegration(this, `${stageName}-${name}-apigw-integration-on-disconnect`, {
      apiId: this.websocketApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.onDisconnectionFunc.functionArn}/invocations`,
      credentialsArn: role.roleArn,
    });
    const onDisconnectionRoute = new aws_apigatewayv2.CfnRoute(this, `${stageName}-${name}-apigw-route-on-disconnect`, {
      apiId: this.websocketApi.ref,
      routeKey: "$disconnect",
      target: `integrations/${onDisconnectionIntegration.ref}`,
      authorizationType: "NONE",
    });

    const onSubscribeIntegration = new aws_apigatewayv2.CfnIntegration(this, `${stageName}-${name}-apigw-integration-on-subscribe`, {
      apiId: this.websocketApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.onSubscribeFunc.functionArn}/invocations`,
      credentialsArn: role.roleArn,
    });
    const onSubscribeRoute = new aws_apigatewayv2.CfnRoute(this, `${stageName}-${name}-apigw-route-on-subscribe`, {
      apiId: this.websocketApi.ref,
      routeKey: "subscribe",
      target: `integrations/${onSubscribeIntegration.ref}`,
      authorizationType: "NONE",
    });

    const onPublishIntegration = new aws_apigatewayv2.CfnIntegration(this, `${stageName}-${name}-apigw-integration-on-publish`, {
      apiId: this.websocketApi.ref,
      integrationType: "AWS_PROXY",
      integrationUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${this.onPublishFunc.functionArn}/invocations`,
      credentialsArn: role.roleArn,
    });
    const onPublishRoute = new aws_apigatewayv2.CfnRoute(this, `${stageName}-${name}-apigw-route-on-publish`, {
      apiId: this.websocketApi.ref,
      routeKey: "publish",
      target: `integrations/${onPublishIntegration.ref}`,
      authorizationType: "NONE",
    });

    const deployment = new aws_apigatewayv2.CfnDeployment(
      this,
      `${stageName}-${name}-apigw-deployment`,
      {
        apiId: this.websocketApi.ref,
      },
    );
    deployment.addDependsOn(this.websocketApi);
    deployment.addDependsOn(onConnectionRoute);
    deployment.addDependsOn(onDisconnectionRoute);
    deployment.addDependsOn(onSubscribeRoute);
    deployment.addDependsOn(onPublishRoute);

    const stage = new aws_apigatewayv2.CfnStage(this, `${stageName}-${name}-apigw-stage`, {
      apiId: this.websocketApi.ref,
      stageName: stageName,
      deploymentId: deployment.ref,
      autoDeploy: true,
    });

    /**
     * output
     */
    new CfnOutput(this, `apigw-stage-output`, {
      value: `wss://${stage.apiId}.execute-api.${region}.amazonaws.com/${stageName}/`,
    });
  }
}
