/**
 * 由 mc-plan-contracts openapi/skin.yaml（版本 0.1.0-alpha.1）生成。
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
    "/v1/conversations/{conversationId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        /**
         * Return conversation detail including the message history
         * @description Returns the conversation with its message history (anonymous-window semantics per ADR-0012: the conversation identifier is unguessable and the conversation is retained for 30 days). Unknown, expired or deleted conversations return 404 without revealing retention details.
         */
        get: operations["getConversation"];
        put?: never;
        post?: never;
        /**
         * Delete the conversation and cascade its candidates and bytes
         * @description Deletes the conversation together with its messages, candidates and candidate bytes immediately (ahead of the 24h/30d retention sweep per ADR-0012). Idempotent within the retention sweep: unknown, expired or already-deleted conversations return 404.
         */
        delete: operations["deleteConversation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/candidates/{candidateId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
                candidateId: string;
            };
            cookie?: never;
        };
        /**
         * Return the 64x64 candidate preview bytes
         * @description Returns the candidate PNG bytes for the given unguessable candidate identifier. Candidates are retained for 24 hours and are removed by the conversation-level delete; unknown, expired or deleted candidates return 404 without distinguishing the reason.
         */
        get: operations["getCandidatePreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/conversations/{conversationId}/skins/{resourceId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
                resourceId: string;
            };
            cookie?: never;
        };
        /**
         * Return the finalized 64x64 skin download bytes
         * @description Returns the finalized skin PNG bytes for the given unguessable resource identifier (published by a succeeded finalize job). The download is bounded by the conversation retention window and is removed by the conversation-level delete; unknown, expired or deleted resources return 404 without distinguishing the reason.
         */
        get: operations["downloadSkin"];
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
        ConversationDetail: {
            conversation_id: string;
            /** @enum {string} */
            status: "active" | "finalizing" | "completed" | "expired" | "cancelled";
            attempts_used: number;
            attempts_limit: number;
            /** Format: date-time */
            expires_at: string;
            messages: {
                /** @enum {string} */
                role: "user" | "assistant";
                content: string;
                /** Format: date-time */
                created_at: string;
            }[];
        };
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
    getConversation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Conversation detail with messages */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationDetail"];
                };
            };
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    deleteConversation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Conversation deleted with all candidates and bytes */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    getCandidatePreview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
                candidateId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidate preview PNG bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
    downloadSkin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                conversationId: components["parameters"]["ConversationId"];
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Finalized skin PNG bytes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                };
            };
            404: components["responses"]["Problem"];
            default: components["responses"]["Problem"];
        };
    };
}

