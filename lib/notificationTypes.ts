export type ApiNotification = {
  id: string
  kind: string
  title: string
  body: string
  workspace_id: string
  channel_id: string | null
  message_id: string | null
  ticket_id: string | null
  read_at: number
  created_at: number
}
