import { NextResponse } from 'next/server'
import { tracedRoute } from '@/lib/api/tracedRoute'

/**
 * GET /api/scim/v2/ServiceProviderConfig
 *
 * RFC 7644 §5 — Service Provider Configuration.
 * Static endpoint. No auth required per spec.
 */

const SERVICE_PROVIDER_CONFIG = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  documentationUri: 'https://aaelink.dev/docs/scim',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description: 'Authentication scheme using the OAuth Bearer Token Standard',
      specUri: 'https://www.rfc-editor.org/info/rfc6750',
      documentationUri: 'https://aaelink.dev/docs/scim/auth',
      primary: true,
    },
  ],
  meta: {
    resourceType: 'ServiceProviderConfig',
    location: '/api/scim/v2/ServiceProviderConfig',
  },
}

async function _GET() {
  return NextResponse.json(SERVICE_PROVIDER_CONFIG, {
    headers: { 'Content-Type': 'application/scim+json' },
  })
}

export const GET = tracedRoute('GET', '/api/scim/v2/ServiceProviderConfig', _GET)
