# Mattermost API Map

## Authentication

- `POST /api/v4/users/login`
- `POST /api/v4/users/logout`
- `GET /api/v4/users/me`

Token:

- header: `Authorization: Bearer <token>`
- cookie: `MMAUTHTOKEN`

## Teams

- `GET /api/v4/users/me/teams`
- `GET /api/v4/teams/{team_id}`

## Channels

- `GET /api/v4/users/me/teams/{team_id}/channels`
- `GET /api/v4/channels/{channel_id}`
- `POST /api/v4/channels`

## Messages

- `GET /api/v4/channels/{channel_id}/posts`
- `POST /api/v4/posts`
- `PUT /api/v4/posts/{post_id}`
- `DELETE /api/v4/posts/{post_id}`

## Threads

- `GET /api/v4/posts/{post_id}/thread`
- thread replies use `root_id`

## Reactions

- `POST /api/v4/reactions`
- `DELETE /api/v4/users/{user_id}/posts/{post_id}/reactions/{emoji_name}`

## WebSocket

- `/api/v4/websocket`

Core events:

- `posted`
- `post_edited`
- `post_deleted`
- `typing`
- `status_change`
- `reaction_added`
- `reaction_removed`
