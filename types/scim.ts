/**
 * SCIM v2 (RFC 7644) types for AAELink.
 *
 * Covers User, Group, ListResponse, PatchOp, Error,
 * Filter, ServiceProviderConfig, Schema, and ResourceType resources.
 * Type-only — no runtime code.
 *
 * @module types/scim
 */

/** SCIM resource metadata per RFC 7644 §3.1. */
export interface ScimMeta {
  /** Resource type name (e.g. "User", "Group"). */
  resourceType: string
  /** ISO-8601 creation timestamp. */
  created: string
  /** ISO-8601 last modified timestamp. */
  lastModified: string
  /** Resource location URI. */
  location: string
  /** ETag for optimistic concurrency. */
  version: string
}

/** SCIM User name component per RFC 7643 §4.1.1. */
export interface ScimUserName {
  /** Full formatted name. */
  formatted: string
  /** Family (last) name. */
  familyName: string
  /** Given (first) name. */
  givenName: string
  /** Middle name(s). */
  middleName?: string
  /** Honorific prefix (e.g. "Dr."). */
  honorificPrefix?: string
  /** Honorific suffix (e.g. "III"). */
  honorificSuffix?: string
}

/** SCIM email sub-attribute per RFC 7643 §4.1.2. */
export interface ScimEmail {
  /** Email address value. */
  value: string
  /** Email type (e.g. "work", "home"). */
  type: string
  /** Whether this is the primary email. */
  primary: boolean
}

/** SCIM group membership reference. */
export interface ScimGroupRef {
  /** Group resource identifier. */
  value: string
  /** Group reference URI. */
  $ref: string
  /** Group display name. */
  display: string
}

/** SCIM User resource per RFC 7644. */
export interface ScimUser {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Unique SCIM resource identifier. */
  id: string
  /** External identifier from the provisioning client. */
  externalId: string
  /** Unique login identifier. */
  userName: string
  /** Structured name components. */
  name: ScimUserName
  /** Email addresses. */
  emails: ScimEmail[]
  /** Whether the user account is active. */
  active: boolean
  /** Groups the user belongs to. */
  groups: ScimGroupRef[]
  /** Resource metadata. */
  meta: ScimMeta
}

/** SCIM Group member reference. */
export interface ScimGroupMember {
  /** User resource identifier. */
  value: string
  /** User reference URI. */
  $ref: string
  /** Member display name. */
  display: string
}

/** SCIM Group resource per RFC 7644. */
export interface ScimGroup {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Unique SCIM resource identifier. */
  id: string
  /** Group display name. */
  displayName: string
  /** Group members. */
  members: ScimGroupMember[]
  /** Resource metadata. */
  meta: ScimMeta
}

/** SCIM paginated list response envelope per RFC 7644 §3.4.2. */
export interface ScimListResponse<T> {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Total number of results matching the query. */
  totalResults: number
  /** 1-based start index of the current page. */
  startIndex: number
  /** Number of results per page. */
  itemsPerPage: number
  /** Array of resources in the current page. */
  Resources: T[]
}

/** SCIM PATCH operation per RFC 7644 §3.5.2. */
export interface ScimPatchOp {
  /** Operation type. */
  op: 'add' | 'remove' | 'replace'
  /** Attribute path (e.g. "emails[type eq \"work\"].value"). */
  path?: string
  /** Value to set (required for add/replace, optional for remove). */
  value?: unknown
}

/** SCIM error response per RFC 7644 §3.12. */
export interface ScimError {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Human-readable error detail. */
  detail: string
  /** HTTP status code as string. */
  status: string
  /** SCIM error type (e.g. "invalidFilter", "tooMany", "uniqueness"). */
  scimType?: string
}

/** SCIM filter operator. */
export type ScimFilterOp =
  | 'eq'
  | 'co'
  | 'sw'
  | 'pr'
  | 'gt'
  | 'lt'
  | 'ge'
  | 'le'

/** Parsed SCIM filter expression. */
export interface ScimFilter {
  /** Attribute path to filter on. */
  attribute: string
  /** Filter operator. */
  op: ScimFilterOp
  /** Comparison value (null for "pr" operator). */
  value: string | null
}

/** Supported feature configuration within ServiceProviderConfig. */
export interface ScimSupportedFeature {
  /** Whether the feature is supported. */
  supported: boolean
}

/** Bulk operation configuration. */
export interface ScimBulkConfig {
  /** Whether bulk operations are supported. */
  supported: boolean
  /** Maximum number of operations per bulk request. */
  maxOperations: number
  /** Maximum payload size in bytes. */
  maxPayloadSize: number
}

/** Filter configuration. */
export interface ScimFilterConfig {
  /** Whether filtering is supported. */
  supported: boolean
  /** Maximum number of results returned. */
  maxResults: number
}

/** Authentication scheme metadata. */
export interface ScimAuthenticationScheme {
  /** Authentication scheme name. */
  name: string
  /** Human-readable description. */
  description: string
  /** Scheme type (e.g. "oauthbearertoken", "httpbasic"). */
  type: string
  /** Specification URI. */
  specUri?: string
  /** Documentation URI. */
  documentationUri?: string
  /** Whether this is the primary scheme. */
  primary?: boolean
}

/** SCIM Service Provider Configuration per RFC 7644 §5. */
export interface ServiceProviderConfig {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Documentation URI for this service provider. */
  documentationUri: string
  /** PATCH operation support. */
  patch: ScimSupportedFeature
  /** Bulk operation support and limits. */
  bulk: ScimBulkConfig
  /** Filter support and limits. */
  filter: ScimFilterConfig
  /** Change password support. */
  changePassword: ScimSupportedFeature
  /** Sort support. */
  sort: ScimSupportedFeature
  /** ETag support. */
  etag: ScimSupportedFeature
  /** Supported authentication schemes. */
  authenticationSchemes: ScimAuthenticationScheme[]
  /** Resource metadata. */
  meta: ScimMeta
}

/** SCIM Schema attribute definition per RFC 7643 §7. */
export interface ScimSchemaAttribute {
  /** Attribute name. */
  name: string
  /** Attribute data type (e.g. "string", "boolean", "complex"). */
  type: string
  /** Whether this attribute supports multiple values. */
  multiValued: boolean
  /** Human-readable description. */
  description: string
  /** Whether this attribute is required. */
  required: boolean
  /** Attribute mutability ("readOnly", "readWrite", "immutable", "writeOnly"). */
  mutability: string
  /** When the attribute is returned ("always", "never", "default", "request"). */
  returned: string
  /** Attribute uniqueness ("none", "server", "global"). */
  uniqueness: string
  /** Sub-attributes for complex types. */
  subAttributes?: ScimSchemaAttribute[]
}

/** SCIM Schema definition per RFC 7643 §7. */
export interface ScimSchema {
  /** Schema identifier URI. */
  id: string
  /** Human-readable name. */
  name: string
  /** Schema description. */
  description: string
  /** Attribute definitions. */
  attributes: ScimSchemaAttribute[]
  /** Resource metadata. */
  meta: ScimMeta
}

/** Schema extension reference used by ScimResourceType. */
export interface ScimSchemaExtension {
  /** Extension schema URI. */
  schema: string
  /** Whether this extension is required. */
  required: boolean
}

/** SCIM ResourceType per RFC 7644 §6. */
export interface ScimResourceType {
  /** SCIM schema URIs. */
  schemas: string[]
  /** Resource type identifier. */
  id: string
  /** Human-readable name. */
  name: string
  /** Human-readable description. */
  description: string
  /** Endpoint URI relative to the base URL. */
  endpoint: string
  /** Core schema URI. */
  schema: string
  /** Schema extensions for this resource type. */
  schemaExtensions: ScimSchemaExtension[]
  /** Resource metadata. */
  meta: ScimMeta
}
