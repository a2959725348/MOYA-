-- Public schema only. Account data and encryption keys belong in private exports.
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(collection,id));
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS events (scope TEXT NOT NULL,id TEXT NOT NULL,observed TEXT NOT NULL,PRIMARY KEY(scope,id));
CREATE TABLE IF NOT EXISTS cloudflare_meta (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,write_token TEXT NOT NULL);
INSERT OR IGNORE INTO cloudflare_meta VALUES (1,0,'');
CREATE TABLE IF NOT EXISTS cloudflare_rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS cloudflare_rate_limits_expires ON cloudflare_rate_limits(expires);
