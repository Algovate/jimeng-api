import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import { getTokenLiveStatus, getCredit, receiveCredit, tokenSplit } from '@/api/controllers/core.ts';
import logger from '@/lib/logger.ts';
import sessionPool from '@/lib/session-pool.ts';

function parseBodyTokens(tokens: any): string[] {
    if (_.isString(tokens)) return tokens.split(",").map((item) => item.trim()).filter(Boolean);
    if (_.isArray(tokens)) return tokens.map((item) => String(item).trim()).filter(Boolean);
    return [];
}

function resolveTokens(authorization?: string): { tokens: string[]; error: string | null } {
    if (_.isString(authorization) && authorization.trim().length > 0) {
        if (!/^Bearer\s+/i.test(authorization)) {
            return { tokens: [], error: "invalid_authorization_format" };
        }
        const tokens = tokenSplit(authorization);
        if (tokens.length === 0) {
            return { tokens: [], error: "empty_authorization_tokens" };
        }
        return { tokens, error: null };
    }
    return {
        tokens: sessionPool.getAllTokens({ onlyEnabled: true, preferLive: true }),
        error: null
    };
}

export default {

    prefix: '/token',

    get: {

        '/pool': async () => {
            return {
                summary: sessionPool.getSummary(),
                items: sessionPool.getEntries(true)
            }
        }

    },

    post: {

        '/check': async (request: Request) => {
            request
                .validate('body.token', _.isString)
            const live = await getTokenLiveStatus(request.body.token);
            return {
                live
            }
        },

        '/points': async (request: Request) => {
            const { tokens, error } = resolveTokens(request.headers.authorization);
            if (error === "invalid_authorization_format") {
                throw new Error("Authorization 格式无效。请使用: Authorization: Bearer <token1[,token2,...]>");
            }
            if (error === "empty_authorization_tokens") {
                throw new Error("Authorization 中未包含有效 token。请使用: Authorization: Bearer <token1[,token2,...]>");
            }
            if (tokens.length === 0) throw new Error("无可用token。请传入 Authorization，或先向 session pool 添加token。");
            const points = await Promise.all(tokens.map(async (token) => {
                return {
                    token,
                    points: await getCredit(token)
                }
            }))
            return points;
        },

        '/receive': async (request: Request) => {
            const { tokens, error } = resolveTokens(request.headers.authorization);
            if (error === "invalid_authorization_format") {
                throw new Error("Authorization 格式无效。请使用: Authorization: Bearer <token1[,token2,...]>");
            }
            if (error === "empty_authorization_tokens") {
                throw new Error("Authorization 中未包含有效 token。请使用: Authorization: Bearer <token1[,token2,...]>");
            }
            if (tokens.length === 0) throw new Error("无可用token。请传入 Authorization，或先向 session pool 添加token。");
            const credits = await Promise.all(tokens.map(async (token) => {
                const currentCredit = await getCredit(token);
                if (currentCredit.totalCredit <= 0) {
                    try {
                        await receiveCredit(token);
                        const updatedCredit = await getCredit(token);
                        return {
                            token,
                            credits: updatedCredit,
                            received: true
                        }
                    } catch (err) {
                        logger.warn('收取积分失败:', err);
                        return {
                            token,
                            credits: currentCredit,
                            received: false,
                            error: err.message
                        }
                    }
                }
                return {
                    token,
                    credits: currentCredit,
                    received: false
                }
            }))
            return credits;
        },

        '/pool/add': async (request: Request) => {
            const tokens = parseBodyTokens(request.body.tokens);
            if (tokens.length === 0) throw new Error("body.tokens 不能为空，支持 string 或 string[]");
            const result = await sessionPool.addTokens(tokens);
            return {
                ...result,
                summary: sessionPool.getSummary()
            };
        },

        '/pool/remove': async (request: Request) => {
            const tokens = parseBodyTokens(request.body.tokens);
            if (tokens.length === 0) throw new Error("body.tokens 不能为空，支持 string 或 string[]");
            const result = await sessionPool.removeTokens(tokens);
            return {
                ...result,
                summary: sessionPool.getSummary()
            };
        },

        '/pool/enable': async (request: Request) => {
            request.validate('body.token', _.isString);
            const updated = await sessionPool.setTokenEnabled(request.body.token, true);
            return {
                updated,
                summary: sessionPool.getSummary()
            };
        },

        '/pool/disable': async (request: Request) => {
            request.validate('body.token', _.isString);
            const updated = await sessionPool.setTokenEnabled(request.body.token, false);
            return {
                updated,
                summary: sessionPool.getSummary()
            };
        },

        '/pool/check': async () => {
            const result = await sessionPool.runHealthCheck();
            return {
                ...result,
                summary: sessionPool.getSummary()
            };
        },

        '/pool/reload': async () => {
            await sessionPool.reloadFromDisk();
            return {
                reloaded: true,
                summary: sessionPool.getSummary(),
                items: sessionPool.getEntries(true)
            };
        }

    }

}
