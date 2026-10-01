/**
 * 由 mc-plan-contracts openapi/skin.yaml（版本 0.1.0-draft）生成。
 * 生成命令：pnpm --filter @mc-plan/skin-contracts gen
 * 禁止手工修改；契约变化先在 mc-plan-contracts 仓库完成。
 */
export interface paths {
    "/v1/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start a skin creation conversation and reserve one creation session */
        post: operations["createConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/renders": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request the next candidate render within the session attempt limit */
        post: operations["createRender"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm a candidate as the final standards-compliant skin */
        post: operations["finalizeSkin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        /** Return render or finalization job status */
        get: operations["getJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Conversation: {
            conversation_id: string;
            /** @enum {string} */
            status: "active" | "finalizing" | "completed" | "expired" | "cancelled";
            attempts_used: number;
            attempts_limit: number;
            /** Format: date-time */
            expires_at: string;
        };
        JobAccepted: {
            job_id: string;
            /** @constant */
            status: "queued";
        };
        Job: {
            job_id: string;
            /** @enum {string} */
            kind: "render" | "finalize";
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
            candidate_id?: string | null;
            resource_id?: string | null;
            error_code?: string | null;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
        };
        /** ProblemDetails */
        problem: {
            /** Format: uri-reference */
            type: string;
            title: string;
            status: number;
            code: string;
            detail?: string;
            trace_id: string;
            errors?: {
                field: string;
                code: string;
                message?: string;
            }[];
        } & {
            [key: string]: unknown;
        };
    };
    responses: {
        /** @description Error response */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["problem"];
            };
        };
    };
    parameters: {
        ConversationId: string;
        IdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    createConversation: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    initial_message: string;
                };
            };
        };
        responses: {
            /** @description Conversation created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Conversation"];
                };
            };
            400: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    createRender: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    message: string;
                    /** @enum {string} */
                    preferred_arm_model?: "steve" | "alex";
                };
            };
        };
        responses: {
            /** @description Render job queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobAccepted"];
                };
            };
            409: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    finalizeSkin: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    candidate_id: string;
                    title: string;
                    description: string;
                };
            };
        };
        responses: {
            /** @description Final validation and mode-specific publication job queued */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobAccepted"];
                };
            };
            409: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    getJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Job state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Job"];
                };
            };
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
}

