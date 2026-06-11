/**
 * Workflow types for AAELink.
 *
 * Defines workflow entities, steps, triggers, and execution tracking
 * for multi-step automation pipelines.
 * Type-only — no runtime code.
 *
 * @module types/workflows
 */

/** Supported workflow step action types. */
export type StepType =
  | 'send_message'
  | 'create_channel'
  | 'invite_to_channel'
  | 'set_channel_topic'
  | 'send_form'
  | 'conditional'
  | 'delay'
  | 'webhook'
  | 'function_call'
  | 'update_user_status'

/** Supported workflow trigger types. */
export type TriggerType =
  | 'shortcut'
  | 'new_channel_member'
  | 'emoji_reaction'
  | 'scheduled'
  | 'webhook'
  | 'channel_created'

/** Workflow execution status. */
export type ExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Workflow entity representing a multi-step automation pipeline. */
export interface Workflow {
  /** Unique workflow identifier. */
  id: string
  /** Workspace this workflow belongs to. */
  workspace_id: string
  /** Human-readable workflow name. */
  name: string
  /** Optional description of what this workflow does. */
  description: string
  /** Ordered list of steps in the workflow. */
  steps: WorkflowStep[]
  /** Triggers that can start this workflow. */
  triggers: WorkflowTrigger[]
  /** Whether this workflow is published and available to users. */
  is_published: boolean
  /** User ID of the workflow creator. */
  creator_id: string
  /** ISO-8601 creation timestamp. */
  created_at: string
  /** ISO-8601 last-updated timestamp. */
  updated_at: string
}

/** A single step within a workflow pipeline. */
export interface WorkflowStep {
  /** Unique step identifier. */
  id: string
  /** Workflow this step belongs to. */
  workflow_id: string
  /** Position of this step in the execution order (1-based). */
  step_order: number
  /** Type of action this step performs. */
  step_type: StepType
  /** Step-specific configuration (varies by step_type). */
  config: Record<string, unknown>
  /** ID of the next step to execute (null for terminal steps). */
  next_step_id: string | null
}

/** Trigger definition that can start a workflow execution. */
export interface WorkflowTrigger {
  /** Unique trigger identifier. */
  id: string
  /** Workflow this trigger is attached to. */
  workflow_id: string
  /** Type of event that activates this trigger. */
  trigger_type: TriggerType
  /** Trigger-specific configuration (varies by trigger_type). */
  config: Record<string, unknown>
  /** Whether this trigger is currently enabled. */
  enabled: boolean
}

/** Record of a single workflow execution run. */
export interface WorkflowExecution {
  /** Unique execution identifier. */
  id: string
  /** Workflow that was executed. */
  workflow_id: string
  /** Trigger that initiated this execution (null if manual). */
  trigger_id: string | null
  /** User ID that started the execution. */
  started_by: string
  /** Current execution status. */
  status: ExecutionStatus
  /** ISO-8601 timestamp when execution started. */
  started_at: string
  /** ISO-8601 timestamp when execution completed (null if still running). */
  completed_at: string | null
  /** Error message if execution failed (null otherwise). */
  error: string | null
}
