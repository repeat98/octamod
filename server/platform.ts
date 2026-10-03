export interface Statement {
  bind(...values: unknown[]): Statement
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown[]> }
export interface Bucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata: { contentType: string } }): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
  delete(key: string): Promise<void>
}
export type Env = { DB?: Database; MEDIA?: Bucket; APP_URL?: string; SESSION_TRANSPORT?: 'cookie' | 'bearer'; REGISTRATION_OPEN?: string; ADMIN_KEY_SHA256?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string; AUTH_SECRET?: string; GITHUB_TOKEN?: string; GITHUB_REPOSITORY?: string; GITHUB_WEBHOOK_SECRET?: string }
export type User = { id: string; display_name: string; username?: string | null; email_verified?: number; suspended?: number }
export type Submission = { id: string; owner_id: string; module_id: string; title: string; repository_url: string; description: string; usage: string; test_report_url: string; stress_notes: string; quality_notes: string; resource_notes: string; license: string; status: 'draft' | 'pending' | 'approved' | 'rejected'; review_note: string; created_at: string }
export type Media = { id: string; submission_id: string; kind: 'image' | 'audio'; mime: string; caption: string; capture_type: string; object_key: string }
