# AAELink API Documentation

## Base URL
- **Development**: `http://localhost:3001/api`
- **Production**: `https://your-domain.com/api`

## Authentication

All API endpoints require authentication except for health checks and public endpoints. Authentication is handled via:

1. **Session Cookies**: For web applications
2. **JWT Tokens**: For mobile applications and API clients
3. **WebAuthn**: For passkey authentication

### Headers
```http
Content-Type: application/json
Authorization: Bearer <jwt_token>
Cookie: session=<session_id>
```

## Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Success message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Authentication Endpoints

### POST /auth/login
Authenticate user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "displayName": "John Doe",
    "role": "user",
    "locale": "en",
    "theme": "light",
    "seniorMode": false
  },
  "sessionId": "session_123"
}
```

### POST /auth/logout
Logout current user.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET /auth/session
Get current user session.

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "displayName": "John Doe",
    "role": "user"
  }
}
```

### POST /auth/register
Register new user.

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "displayName": "New User"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_456",
    "email": "newuser@example.com",
    "displayName": "New User",
    "role": "user"
  }
}
```

## Messaging Endpoints

### GET /messages/:channelId
Get messages for a specific channel.

**Parameters:**
- `channelId` (string): Channel identifier
- `limit` (number, optional): Number of messages to return (default: 50)
- `offset` (number, optional): Number of messages to skip (default: 0)

**Response:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "msg_123",
      "content": "Hello world!",
      "userId": "user_123",
      "channelId": "channel_456",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "reactions": [],
      "attachments": []
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 100
  }
}
```

### POST /messages
Send a new message.

**Request Body:**
```json
{
  "content": "Hello world!",
  "channelId": "channel_456",
  "attachments": [
    {
      "type": "file",
      "fileId": "file_123",
      "name": "document.pdf"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "msg_789",
    "content": "Hello world!",
    "userId": "user_123",
    "channelId": "channel_456",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### PUT /messages/:id
Update a message.

**Parameters:**
- `id` (string): Message identifier

**Request Body:**
```json
{
  "content": "Updated message content"
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "id": "msg_123",
    "content": "Updated message content",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### DELETE /messages/:id
Delete a message.

**Parameters:**
- `id` (string): Message identifier

**Response:**
```json
{
  "success": true,
  "message": "Message deleted successfully"
}
```

## File Management Endpoints

### POST /files/upload
Upload a file.

**Request Body:** Multipart form data
- `file`: File to upload
- `channelId` (optional): Channel to associate file with

**Response:**
```json
{
  "success": true,
  "file": {
    "id": "file_123",
    "name": "document.pdf",
    "size": 1024000,
    "mimeType": "application/pdf",
    "url": "https://storage.example.com/files/file_123",
    "uploadedBy": "user_123",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### GET /files/:id
Download a file.

**Parameters:**
- `id` (string): File identifier

**Response:** File content with appropriate headers

### DELETE /files/:id
Delete a file.

**Parameters:**
- `id` (string): File identifier

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

### GET /files
List user's files.

**Query Parameters:**
- `limit` (number, optional): Number of files to return
- `offset` (number, optional): Number of files to skip
- `channelId` (string, optional): Filter by channel

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "id": "file_123",
      "name": "document.pdf",
      "size": 1024000,
      "mimeType": "application/pdf",
      "url": "https://storage.example.com/files/file_123",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 25
  }
}
```

## Calendar Endpoints

### GET /calendar/events
Get calendar events.

**Query Parameters:**
- `startDate` (string, optional): Start date (ISO 8601)
- `endDate` (string, optional): End date (ISO 8601)
- `limit` (number, optional): Number of events to return

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "id": "event_123",
      "title": "Team Meeting",
      "description": "Weekly team standup",
      "startDate": "2024-01-01T09:00:00.000Z",
      "endDate": "2024-01-01T10:00:00.000Z",
      "allDay": false,
      "location": "Conference Room A",
      "attendees": ["user_123", "user_456"],
      "createdBy": "user_123",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /calendar/events
Create a new event.

**Request Body:**
```json
{
  "title": "Team Meeting",
  "description": "Weekly team standup",
  "startDate": "2024-01-01T09:00:00.000Z",
  "endDate": "2024-01-01T10:00:00.000Z",
  "allDay": false,
  "location": "Conference Room A",
  "attendees": ["user_123", "user_456"]
}
```

**Response:**
```json
{
  "success": true,
  "event": {
    "id": "event_123",
    "title": "Team Meeting",
    "description": "Weekly team standup",
    "startDate": "2024-01-01T09:00:00.000Z",
    "endDate": "2024-01-01T10:00:00.000Z",
    "allDay": false,
    "location": "Conference Room A",
    "attendees": ["user_123", "user_456"],
    "createdBy": "user_123",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### PUT /calendar/events/:id
Update an event.

**Parameters:**
- `id` (string): Event identifier

**Request Body:**
```json
{
  "title": "Updated Team Meeting",
  "description": "Updated description"
}
```

**Response:**
```json
{
  "success": true,
  "event": {
    "id": "event_123",
    "title": "Updated Team Meeting",
    "description": "Updated description",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### DELETE /calendar/events/:id
Delete an event.

**Parameters:**
- `id` (string): Event identifier

**Response:**
```json
{
  "success": true,
  "message": "Event deleted successfully"
}
```

### GET /calendar/upcoming
Get upcoming events.

**Query Parameters:**
- `days` (number, optional): Number of days ahead (default: 7)

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "id": "event_123",
      "title": "Team Meeting",
      "startDate": "2024-01-01T09:00:00.000Z",
      "endDate": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

## Search Endpoints

### GET /search
Perform global search.

**Query Parameters:**
- `q` (string): Search query
- `type` (string, optional): Content type filter (all, messages, files, events)
- `limit` (number, optional): Number of results to return

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "id": "result_123",
      "type": "message",
      "title": "Team Meeting Discussion",
      "content": "We discussed the project timeline...",
      "channelId": "channel_456",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "score": 0.95
    }
  ],
  "query": "team meeting",
  "total": 1,
  "pagination": {
    "limit": 50,
    "offset": 0
  }
}
```

### GET /search/suggestions
Get search suggestions.

**Query Parameters:**
- `q` (string): Partial search query

**Response:**
```json
{
  "success": true,
  "suggestions": [
    "team meeting",
    "team building",
    "team standup"
  ]
}
```

## Admin Endpoints

### GET /admin/stats
Get system statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "users": 150,
    "messages": 5000,
    "files": 250,
    "organizations": 5,
    "activeConnections": 25,
    "systemHealth": "healthy",
    "lastSync": "2024-01-01T00:00:00.000Z",
    "security": {
      "totalAuditLogs": 1000,
      "totalSecurityEvents": 50,
      "failedLoginAttempts": 5,
      "activePolicies": 3,
      "criticalEvents": 0
    }
  }
}
```

### GET /admin/users
Get user list.

**Query Parameters:**
- `limit` (number, optional): Number of users to return
- `offset` (number, optional): Number of users to skip
- `role` (string, optional): Filter by role

**Response:**
```json
{
  "success": true,
  "users": [
    {
      "id": "user_123",
      "email": "user@example.com",
      "displayName": "John Doe",
      "role": "user",
      "lastLogin": "2024-01-01T00:00:00.000Z",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 150
  }
}
```

### POST /admin/users
Create a new user.

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "displayName": "New User",
  "role": "user",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user_456",
    "email": "newuser@example.com",
    "displayName": "New User",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Security Endpoints

### GET /security/audit-logs
Get audit logs.

**Query Parameters:**
- `userId` (string, optional): Filter by user ID
- `action` (string, optional): Filter by action
- `startDate` (string, optional): Start date filter
- `endDate` (string, optional): End date filter
- `limit` (number, optional): Number of logs to return

**Response:**
```json
{
  "success": true,
  "logs": [
    {
      "id": "log_123",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "userId": "user_123",
      "action": "login",
      "resource": "/api/auth/login",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "success": true,
      "severity": "low"
    }
  ]
}
```

### GET /security/events
Get security events.

**Query Parameters:**
- `type` (string, optional): Event type filter
- `severity` (string, optional): Severity filter
- `resolved` (boolean, optional): Resolved status filter
- `limit` (number, optional): Number of events to return

**Response:**
```json
{
  "success": true,
  "events": [
    {
      "id": "event_123",
      "type": "login_attempt",
      "severity": "high",
      "userId": "user_123",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "details": {
        "attemptCount": 5,
        "isBlocked": true
      },
      "timestamp": "2024-01-01T00:00:00.000Z",
      "resolved": false
    }
  ]
}
```

### GET /security/stats
Get security statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "totalAuditLogs": 1000,
    "totalSecurityEvents": 50,
    "failedLoginAttempts": 5,
    "activePolicies": 3,
    "criticalEvents": 0
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication required |
| `INVALID_CREDENTIALS` | Invalid email or password |
| `SESSION_EXPIRED` | Session has expired |
| `INSUFFICIENT_PERMISSIONS` | User lacks required permissions |
| `VALIDATION_ERROR` | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `FILE_TOO_LARGE` | File size exceeds limit |
| `INVALID_FILE_TYPE` | File type not allowed |
| `RESOURCE_NOT_FOUND` | Requested resource not found |
| `INTERNAL_ERROR` | Internal server error |

## Rate Limiting

API endpoints are rate limited to prevent abuse:

- **Authentication endpoints**: 5 requests per minute per IP
- **General API endpoints**: 100 requests per 15 minutes per IP
- **File upload endpoints**: 10 requests per minute per user
- **Search endpoints**: 50 requests per minute per user

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## WebSocket Events

Real-time events are sent via WebSocket connection:

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3001/ws?userId=user_123');
```

### Event Types

#### Message Events
```json
{
  "type": "message",
  "payload": {
    "id": "msg_123",
    "content": "Hello world!",
    "userId": "user_123",
    "channelId": "channel_456",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### Typing Events
```json
{
  "type": "typing",
  "payload": {
    "userId": "user_123",
    "channelId": "channel_456",
    "isTyping": true
  }
}
```

#### Presence Events
```json
{
  "type": "presence",
  "payload": {
    "userId": "user_123",
    "action": "joined",
    "timestamp": 1640995200000
  }
}
```

#### Reaction Events
```json
{
  "type": "reaction",
  "payload": {
    "messageId": "msg_123",
    "reaction": "👍",
    "userId": "user_123"
  }
}
```

## SDK Examples

### JavaScript/TypeScript
```typescript
import { AAELinkClient } from '@aaelink/client';

const client = new AAELinkClient({
  baseUrl: 'http://localhost:3001/api',
  apiKey: 'your-api-key'
});

// Login
const user = await client.auth.login({
  email: 'user@example.com',
  password: 'password123'
});

// Send message
const message = await client.messages.send({
  content: 'Hello world!',
  channelId: 'channel_123'
});

// Get events
const events = await client.calendar.getEvents({
  startDate: '2024-01-01',
  endDate: '2024-01-31'
});
```

### Python
```python
import aaelink

client = aaelink.Client(
    base_url='http://localhost:3001/api',
    api_key='your-api-key'
)

# Login
user = client.auth.login(
    email='user@example.com',
    password='password123'
)

# Send message
message = client.messages.send(
    content='Hello world!',
    channel_id='channel_123'
)

# Get events
events = client.calendar.get_events(
    start_date='2024-01-01',
    end_date='2024-01-31'
)
```

## Testing

### Postman Collection
Import the Postman collection from `docs/postman/AAELink-API.postman_collection.json`

### cURL Examples
```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Get messages
curl -X GET "http://localhost:3001/api/messages/channel_123?limit=50" \
  -H "Authorization: Bearer your-jwt-token"

# Upload file
curl -X POST http://localhost:3001/api/files/upload \
  -H "Authorization: Bearer your-jwt-token" \
  -F "file=@document.pdf" \
  -F "channelId=channel_123"
```

## Changelog

### v1.0.0 (2024-01-01)
- Initial API release
- Authentication endpoints
- Messaging system
- File management
- Calendar integration
- Search functionality
- Admin console
- Security monitoring
