import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ModelSelection, SessionController } from '@deepseek-ai/dsh-api-session-controller';
import { type SessionId as SessionIdValue } from '@deepseek-ai/dsh-session';
import type { Workspace } from '@deepseek-ai/dsh-workspace';
/** Session Controller operations used to create fully composed ordinary conversations. */
export type WindowSessionController = Pick<SessionController, 'create' | 'rename' | 'resolveAgent' | 'selectModel' | 'inspect'>;
/** Optional parent-owned product boundary that creates a fully bound product conversation. */
export interface WindowConversationHost {
    /** Resolve whether the initiating Session belongs to the product parent or ordinary DSH. */
    conversationCreateScope?(context: {
        readonly sessionId: SessionIdValue;
        readonly signal: AbortSignal;
    }): Promise<{
        readonly mode: 'product' | 'dsh';
    }>;
    /** Create one product conversation in the project authorized for the initiating Session. */
    conversationCreate(request: {
        readonly title: string;
        readonly agentPreset?: string;
    }, context: {
        readonly sessionId: SessionIdValue;
        readonly signal: AbortSignal;
    }): Promise<{
        readonly dshSessionId: string;
        readonly appSessionId?: string;
    }>;
}
/** Input for creating one missing role window. */
export interface ProvisionConversationWindowRequest {
    readonly source: Agent;
    readonly title: string;
    readonly cwd: string;
    readonly workspace?: Pick<Workspace, 'id'>;
    readonly signal: AbortSignal;
}
/** Fully composed, live ordinary conversation returned after provisioning. */
export interface ProvisionedConversationWindow {
    readonly sessionId: SessionIdValue;
    readonly agent: Agent;
}
/** Create normal conversations without copying or naming individual tool capabilities. */
export declare class ConversationWindowProvisioner {
    #private;
    private readonly sessions;
    private readonly productHost?;
    /** @param sessions - Official owner of ordinary Session composition. @param productHost - Optional parent product creator. */
    constructor(sessions: WindowSessionController, productHost?: WindowConversationHost | undefined);
    /** Create, name, select the source model, and resolve one fully composed role window. */
    create(request: ProvisionConversationWindowRequest): Promise<ProvisionedConversationWindow>;
}
/** Narrow an optional Host service without treating its presence as authorization. */
export declare function windowConversationHost(value: unknown): WindowConversationHost | undefined;
/** Read the exact route already assembled for the initiating turn. */
export declare function currentModelSelection(agent: Agent): ModelSelection | undefined;
//# sourceMappingURL=provisioner.d.ts.map