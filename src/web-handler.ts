import {RouterConfig} from './route/router-config';
import {APIGatewayEvent, Callback, Context, ProxyResult} from 'aws-lambda';
import {Logger} from '@bitblit/ratchet/dist/common/logger';
import * as zlib from 'zlib';
import * as Route from 'route-parser';
import {UnauthorizedError} from './error/unauthorized-error';
import {ForbiddenError} from './error/forbidden-error';
import {WebTokenManipulator} from './auth/web-token-manipulator';
import {CommonJwtToken} from '@bitblit/ratchet/dist/common/common-jwt-token';
import {RouteMapping} from './route/route-mapping';
import {MisconfiguredError} from './error/misconfigured-error';
import {BadRequestError} from './error/bad-request-error';
import {ResponseUtil} from './response-util';

export class WebHandler {
    public static readonly DEFAULT_HANDLER_FUNCTION_NAME: string = 'handler';
    private routerConfig: RouterConfig;
    private webTokenManipulator;
    private corsAllowedHeaders: string = 'Authorization, Origin, X-Requested-With, Content-Type, Range';  // Since safari hates '*'
    private corsResponse: ProxyResult = {statusCode:200, body: '{"cors":true}', headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':this.corsAllowedHeaders}} as ProxyResult;

    constructor(routing: RouterConfig)
    {
        this.routerConfig = routing;
        if (this.routerConfig.enableAuthorizationHeaderParsing) {
            if (!this.routerConfig.authorizationHeaderEncryptionKey) {
                throw new Error('If you set enableAuthorizationHeaderParsing you must set authorizationHeaderEncryptionKey');
            }
            this.webTokenManipulator = new WebTokenManipulator(this.routerConfig.authorizationHeaderEncryptionKey, '');
        }
    }

    public lambdaHandler (event: APIGatewayEvent, context: Context, callback: Callback) : void {
        try {
            if (!this.routerConfig)
            {
                throw new Error('Router config not found');
            }

            let handler: Promise<any> = this.findHandler(event);

            Logger.debug('Processing event : %j', event);

            handler.then(result=>{
                Logger.debug('Returning : %j', result);
                let proxyResult: ProxyResult = ResponseUtil.coerceToProxyResult(result);
                callback(null, this.addCors(proxyResult));
                // TODO: Re-enable : this.zipAndReturn(JSON.stringify(result), 'application/json', callback);
            }).catch(err=>{
                Logger.warn('Unhandled error (in promise catch) : %s \nStack was: %s\nEvt was: %j',err.message, err.stack, event);
                callback(null,this.addCors(ResponseUtil.errorToProxyResult(err)));
            });


        }
        catch (err)
        {
            Logger.warn('Unhandled error (in wrapping catch) : %s \nStack was: %s\nEvt was: %j',err.message, err.stack, event);
            callback(null,this.addCors(ResponseUtil.errorToProxyResult(err)));
        }
    };


    private cleanPath(event: APIGatewayEvent) : string
    {
        let rval : string = event.path;
        // First, strip any leading /
        while (rval.startsWith('/'))
        {
            rval = rval.substring(1);
        }
        // Next, if there is a stage, remove it
        let stage : string = event.requestContext.stage;
        if (stage && rval.startsWith(stage))
        {
            rval = rval.substring(stage.length);
        } else if (stage && this.routerConfig.customStageValue && rval.startsWith(this.routerConfig.customStageValue)) {
            rval = rval.substring(this.routerConfig.customStageValue.length);
        }
        // Finally, strip any more leading /
        while (rval.startsWith('/'))
        {
            rval = rval.substring(1);
        }

        return rval;
    }

    // Public so it can be used in auth-web-handler
    public addCors(input: ProxyResult) : ProxyResult
    {
        if (!this.routerConfig.disableCORS)
        {
            ResponseUtil.addCORSToProxyResult(input, this.corsAllowedHeaders);
        }
        return input;
    }

    public async findHandler(event: APIGatewayEvent): Promise<any>
    {
        let rval: Promise<any> = null;

        if (event.httpMethod=='OPTIONS' && !this.routerConfig.disableCORS)
        {
            Logger.debug('Options call, returning CORS');
            rval = Promise.resolve(this.corsResponse);
        } else {
            // See: https://www.npmjs.com/package/route-parser
            let cleanPath:string = this.cleanPath(event);
            for (let i = 0; i<this.routerConfig.routes.length; i++)
            {
                const rm: RouteMapping = this.routerConfig.routes[i];
                if (!rval) // TODO: Short circuit would be better
                {
                    if (rm.method && rm.method.toLowerCase()===event.httpMethod.toLowerCase())
                    {
                        let routeParser: Route = new Route(rm.path);
                        let parsed: any = routeParser.match(cleanPath);
                        if (parsed)
                        {
                            // We extend with the parsed params here in case we are using the AWS any proxy
                            event.pathParameters = Object.assign({}, event.pathParameters, parsed);

                            // Check authentication / authorization
                            const passAuth: boolean = await this.applyAuth(event, rm);

                            // Check validation
                            const passBodyValid: boolean = await this.applyBodyObjectValidation(event, rm);

                            // Cannot get here without a valid auth/body, would've thrown an error
                            const handlerName: string = rm.handlerName || WebHandler.DEFAULT_HANDLER_FUNCTION_NAME;
                            rval = rm.handlerOb[handlerName](event);
                        }
                    }
                }
            }
        }

        if (!rval)
        {
            Logger.debug('Failed to find handler for %s',event.path);
            rval = Promise.resolve(ResponseUtil.errorResponse(['No such endpoint'],404));
        }
        return rval;

    }

    private async applyBodyObjectValidation(event: APIGatewayEvent, route: RouteMapping): Promise<boolean> {
        if (!event || !route) {
            throw new MisconfiguredError('Missing event or route');
        }
        let rval: boolean = true;

        if (route.validation) {
            if (!this.routerConfig.modelValidator) {
                throw new MisconfiguredError('Requested body validation but supplied no validator');
            }
            const errors: string[] = this.routerConfig.modelValidator.validate(route.validation.modelName,
                route.validation.emptyAllowed, route.validation.extraPropertiesAllowed);
            if (errors.length > 0) {
                Logger.info('Found errors while validating %s object %j', route.validation.modelName, errors);
                const newError: BadRequestError = new BadRequestError(...errors);
                rval = false;
                throw newError;
            }
        }
        return rval;
    }

    // Returns a failing proxy result if no auth, otherwise returns null
    private async applyAuth(event: APIGatewayEvent, route: RouteMapping): Promise<boolean> {
        if (!event || !route) {
            throw new MisconfiguredError('Missing event or route');
        }
        let rval: boolean = true;

        if (route.auth) {
            if (!this.webTokenManipulator) {
                throw new MisconfiguredError('Auth is defined, but token manipulator not set - missing key?');
            }
            // Extract the token
            const token: CommonJwtToken<any> = this.webTokenManipulator.extractTokenFromStandardEvent(event);
            if (!token) {
                Logger.info('Failed auth for route : %s - missing/bad token', route.path);
                rval = false; // Not that it matters
                throw new UnauthorizedError('Missing or bad token');
            } else {
                if (route.auth.handlerOb) {
                    const handlerName: string = route.auth.handlerName || WebHandler.DEFAULT_HANDLER_FUNCTION_NAME;
                    const passes: boolean = await route.auth.handlerOb[handlerName](token, event, route);
                    if (!passes) {
                        throw new ForbiddenError('Failed authorization');
                        rval = false;
                    }
                }
            }

            if (rval) {
                // Put the token into scope just like it would be from a AWS authorizer
                event.requestContext.authorizer['userData'] = token;
                event.requestContext.authorizer['userDataJSON'] = (token) ? JSON.stringify(token) : null;
                event.requestContext.authorizer['srcData'] = WebTokenManipulator.extractTokenStringFromStandardEvent(event);
            }

        }

        return rval;
    }

    private zipAndReturn(content:any, contentType:string, callback:Callback) : void
    {
        if (this.shouldGzip(content.length,contentType)) {
            this.gzip(content).then((compressed) => {
                let contents64 = compressed.toString('base64');

                let response = {
                    statusCode: 200,
                    isBase64Encoded: true,
                    headers: {
                        'Content-Type': contentType,
                        'content-encoding': 'gzip'
                    },
                    body: contents64
                };

                Logger.debug("Sending response with gzip body, length is %d", contents64.length);
                callback(null, response);
            });
        }
        else
        {
            let contents64 = content.toString('base64');

            let response = {
                statusCode: 200,
                isBase64Encoded: true,
                headers: {
                    'Content-Type': contentType,
                },
                body: contents64
            };

            Logger.debug("Sending response with gzip body, length is %d", contents64.length);
            callback(null, response);

        }
    }


    private shouldGzip(fileSize: number, contentType:string) : boolean {
        /*

        let rval : boolean = (fileSize>2048); // MTU packet is 1400 bytes
        if (rval && contentType) {
          let test : string = contentType.toLowerCase();
          if (test.startsWith("image/") && test.indexOf('svg')==-1)
          {
            rval = false;
          }
          else if (test=='application/pdf')
          {
            rval = false;
          }
        }

        return rval;
        */
        // May put this back in later
        return true;
    }


    private gzip(input, options={}) : Promise<Buffer>{
        var promise = new Promise<Buffer>(function (resolve, reject) {
            zlib.gzip(input, options, function (error, result) {
                if (!error) resolve(result);else reject(error);
            });
        });
        return promise;
    };

}
