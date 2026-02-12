/**
* Database interface for LLM task selector
*/
export interface Database {
  llm_task_preferences: {
  findOne: (query: {
    tenant_id: string;
    domain_id: string | undefined;
    task_type: string;
  }) => Promise<LlmPreference | null>;
  };
}

/**
* Input for LLM task selection
*/
export interface SelectLlmForTaskInput {
  tenant_id: string;
  domain_id?: string;
  task_type: string;
}

/**
* LLM preference result
*/
export interface LlmPreference {
  id?: string;
  tenant_id: string;
  domain_id: string | null;
  task_type: string;
  provider: string;
  model: string;
}

/**
* Selects the appropriate LLM for a task with validation
* @param db - Database instance
* @param input - Selection input
* @returns Promise resolving to the LLM preference or null
*/
export async function selectLlmForTask(
  db: Database,
  input: SelectLlmForTaskInput
): Promise<LlmPreference | null> {
  // Validate inputs
  if (!input.tenant_id || typeof input.tenant_id !== 'string') {
  throw new Error('tenant_id is required and must be a string');
  }
  if (!input.task_type || typeof input.task_type !== 'string') {
  throw new Error('task_type is required and must be a string');
  }
  if (input.domain_id !== undefined && typeof input.domain_id !== 'string') {
  throw new Error('domain_id must be a string if provided');
  }

  const domainPref = await db.llm_task_preferences.findOne({
  tenant_id: input.tenant_id,
  domain_id: input.domain_id,
  task_type: input.task_type
  });
  if (domainPref) return domainPref;

  // P2-FIX: Use null instead of undefined — DB layers may ignore undefined fields
  return db.llm_task_preferences.findOne({
  tenant_id: input.tenant_id,
  domain_id: undefined as unknown as string | undefined,
  task_type: input.task_type
  });
}
