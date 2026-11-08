
CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX shares_expires ON shares (expires);
