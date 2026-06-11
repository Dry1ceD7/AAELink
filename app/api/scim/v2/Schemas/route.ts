import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/scim/v2/Schemas
 *
 * RFC 7644 — SCIM Schema definitions.
 * Returns the User and Group schemas supported by this provider.
 */

const SCHEMAS = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 2,
  itemsPerPage: 2,
  startIndex: 1,
  Resources: [
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      description: 'User Account',
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
        { name: 'name', type: 'complex', multiValued: false, required: false, subAttributes: [
          { name: 'givenName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
          { name: 'familyName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        ]},
        { name: 'emails', type: 'complex', multiValued: true, required: true, subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: true },
          { name: 'type', type: 'string', multiValued: false, required: false },
          { name: 'primary', type: 'boolean', multiValued: false, required: false },
        ]},
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
        { name: 'externalId', type: 'string', multiValued: false, required: false, caseExact: true, mutability: 'readWrite', returned: 'default' },
      ],
      meta: { resourceType: 'Schema', location: '/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User' },
    },
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      name: 'Group',
      description: 'Group',
      attributes: [
        { name: 'displayName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default' },
        { name: 'members', type: 'complex', multiValued: true, required: false, subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: true },
          { name: 'display', type: 'string', multiValued: false, required: false, mutability: 'readOnly' },
        ]},
      ],
      meta: { resourceType: 'Schema', location: '/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group' },
    },
  ],
}

async function _GET() {
  return NextResponse.json(SCHEMAS, {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

export const GET = tracedRoute('GET', '/api/scim/v2/Schemas', _GET)
