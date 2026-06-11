/**
 * Function types for AAELink.
 *
 * Defines custom and built-in functions, their parameter schemas,
 * and execution records for the automation platform.
 * Type-only — no runtime code.
 *
 * @module types/functions
 */

/** Function origin type. */
export type FunctionType =
  | 'builtin'
  | 'custom'
  | 'connector'

/** Supported parameter data types for function I/O. */
export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'user'
  | 'channel'
  | 'timestamp'
  | 'rich_text'
  | 'array'
  | 'object'

/** A registered function available for workflow steps or direct invocation. */
export interface Function {
  /** Unique function identifier. */
  id: string
  /** Workspace this function belongs to. */
  workspace_id: string
  /** App that provides this function (null if builtin). */
  app_id: string | null
  /** Function code name (machine-readable). */
  name: string
  /** Human-readable function title. */
  title: string
  /** Description of what this function does. */
  description: string
  /** Ordered list of input parameters. */
  input_parameters: FunctionParameter[]
  /** Ordered list of output parameters. */
  output_parameters: FunctionParameter[]
  /** Function origin type. */
  type: FunctionType
  /** Whether this function is enabled for use. */
  is_enabled: boolean
}

/** Schema definition for a single function parameter. */
export interface FunctionParameter {
  /** Parameter name (machine-readable key). */
  name: string
  /** Data type of this parameter. */
  type: ParameterType
  /** Human-readable description. */
  description: string
  /** Whether this parameter must be provided. */
  is_required: boolean
  /** Default value when the parameter is omitted (null if none). */
  default_value: unknown
}

/** Record of a single function execution. */
export interface FunctionExecution {
  /** Unique execution identifier. */
  id: string
  /** Function that was executed. */
  function_id: string
  /** Workflow execution that triggered this run (null if direct). */
  workflow_execution_id: string | null
  /** Input values provided to the function. */
  inputs: Record<string, unknown>
  /** Output values returned by the function (null if not completed). */
  outputs: Record<string, unknown> | null
  /** Execution status (pending, running, completed, failed). */
  status: string
  /** ISO-8601 timestamp when execution started. */
  started_at: string
  /** ISO-8601 timestamp when execution completed (null if still running). */
  completed_at: string | null
  /** Error message if execution failed (null otherwise). */
  error: string | null
}
