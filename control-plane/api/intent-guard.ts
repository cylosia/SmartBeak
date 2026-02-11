import { FastifyRequest } from 'fastify';


/**
* Intent interface for type-safe access
* P2-MEDIUM FIX: Define proper interface instead of using any
*/
export interface Intent {
  id: string;
  intent_type: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
}

/**
* Extended Fastify request with intent
* P2-MEDIUM FIX: Properly extend request type instead of using any
*/
export type RequestWithIntent = FastifyRequest & {
  intent?: Intent | undefined;
};

/**
* P1-FIX: Moved interface declaration to top level, not inside function
* Extended Fastify request with database access
*/
export type RequestWithDb = FastifyRequest & {
  server?: {
    db?: {
      human_intents?: {
        findOne: (id: string) => Promise<Intent | null>;
      };
    };
  } | undefined;
};

/**
* Require human intent middleware
* P1-FIX: Use proper TypeScript interfaces instead of type assertions
* @param opts - Options with allowed intent types
* @returns Middleware function
*/
export function requireIntent(opts: { allowedTypes: string[] }) {
  return async function (req: FastifyRequest): Promise<void> {
    const intentId = req.headers['x-intent-id'];
    if (!intentId || typeof intentId !== 'string') {
      throw new Error('Missing required human intent');
    }

    // P1-FIX: Type-safe database access with proper interface extension
    const reqWithDb = req as RequestWithDb;
    const db = reqWithDb.server?.db;
    if (!db?.human_intents) {
      throw new Error('Database not available');
    }
    const intent = await db.human_intents.findOne(intentId);

    if (!intent) throw new Error('Intent not found');
    if (!opts.allowedTypes.includes(intent.intent_type)) {
      throw new Error('Intent type not permitted');
    }
    if (intent.status !== 'approved') {
      throw new Error('Intent must be approved');
    }

    // P1-FIX: Use proper type extension instead of (req as any)
    const reqWithIntent = req as RequestWithIntent;
    reqWithIntent.intent = intent;
  };
}

/**
* Get intent from request safely
* @param req - Fastify request
* @returns Intent or undefined
*/
export function getIntent(req: FastifyRequest): Intent | undefined {
  return (req as RequestWithIntent).intent;
}

/**
* Check if request has intent
* @param req - Fastify request
* @returns True if request has intent
*/
export function hasIntent(req: FastifyRequest): boolean {
  return !!(req as RequestWithIntent).intent;
}
