-- A private, reversible request queue. Submitting a request does not remove an account or its content.
CREATE TABLE account_removal_requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','reviewing','completed','cancelled')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX account_removal_active ON account_removal_requests(user_id) WHERE status IN ('requested','reviewing');

-- Aggregate provider outcomes only: no recipient, token, response body or message ID.
CREATE TABLE account_mail_daily (
 day TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
 accepted INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, limited INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,purpose)
);
