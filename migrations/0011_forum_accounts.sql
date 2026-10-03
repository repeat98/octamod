-- Email accounts are separate from historical device guests; names never prove ownership.
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;
CREATE TABLE account_tokens (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')), expires INTEGER NOT NULL
);
CREATE INDEX account_tokens_user ON account_tokens(user_id,purpose);
CREATE TABLE forum_threads (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, category TEXT NOT NULL CHECK(category IN ('general','modules','issues','configs')),
 module_id TEXT, configuration_json TEXT, issue_json TEXT,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 locked INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX forum_threads_recent ON forum_threads(hidden,pinned,updated_at);
CREATE INDEX forum_threads_module ON forum_threads(module_id,hidden,updated_at);
CREATE TABLE forum_posts (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES forum_threads(id), user_id TEXT NOT NULL REFERENCES users(id),
 body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 edited_at TEXT
);
CREATE INDEX forum_posts_thread ON forum_posts(thread_id,created_at,id);
CREATE TABLE forum_reactions (post_id TEXT NOT NULL REFERENCES forum_posts(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(post_id,user_id));
CREATE TABLE forum_follows (thread_id TEXT NOT NULL REFERENCES forum_threads(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(thread_id,user_id));
CREATE TABLE forum_bookmarks (thread_id TEXT NOT NULL REFERENCES forum_threads(id),user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(thread_id,user_id));
CREATE TABLE forum_notifications (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),thread_id TEXT NOT NULL REFERENCES forum_threads(id),
 post_id TEXT NOT NULL REFERENCES forum_posts(id), seen INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX forum_notifications_user ON forum_notifications(user_id,seen,created_at);
CREATE TABLE forum_reports (
 id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES forum_posts(id),user_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,
 resolved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(post_id,user_id)
);
CREATE TABLE forum_moderation (
 id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),target TEXT NOT NULL,action TEXT NOT NULL,
 reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
