import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/scim/v2/ResourceTypes
 *
 * RFC 7644 — SCIM Resource Type definitions.
 * Declares User and Group resource types supported by this provider.
 */

const RESOURCE_TYPES = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 2,
  itemsPerPage: 2,
  startIndex: 1,
  Resources: [
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      description: 'User Account',
      endpoint: '/api/scim/v2/Users',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
      schemaExtensions: [],
      meta: {
        resourceType: 'ResourceType',
        location: '/api/scim/v2/ResourceTypes/User',
      },
    },
    {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'Group',
      name: 'Group',
      description: 'Group',
      endpoint: '/api/scim/v2/Groups',
      schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      schemaExtensions: [],
      meta: {
        resourceType: 'ResourceType',
        location: '/api/scim/v2/ResourceTypes/Group',
      },
    },
  ],
}

async function _GET() {
  return NextResponse.json(RESOURCE_TYPES, {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

export const GET = tracedRoute('GET', '/api/scim/v2/ResourceTypes', _GET)
