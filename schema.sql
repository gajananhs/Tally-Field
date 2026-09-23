-- ============================================================
-- TallyField — reference schema
-- MySQL / MariaDB, PDO-compatible
-- Incorporates fixes from the Release QA Pass:
--   - visits.scheduled_date column + index (Defect 3)
--   - field_transactions (tenant_id, created_at) index (Defect 8)
-- ============================================================

CREATE TABLE tenants (
  id            CHAR(36)     PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  tally_company VARCHAR(150) NOT NULL,
  plan          VARCHAR(30)  NOT NULL DEFAULT 'trial',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE users (
  id         CHAR(36)     PRIMARY KEY,
  tenant_id  CHAR(36)     NOT NULL,
  role       ENUM('owner','admin','rep') NOT NULL,
  name       VARCHAR(120) NOT NULL,
  phone      VARCHAR(15)  NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_users_tenant_phone (tenant_id, phone)
) ENGINE=InnoDB;

CREATE TABLE otp_codes (
  id         CHAR(36)  PRIMARY KEY,
  user_id    CHAR(36)  NOT NULL,
  code_hash  CHAR(64)  NOT NULL,
  attempts   TINYINT   NOT NULL DEFAULT 0,
  expires_at DATETIME  NOT NULL,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_otp_user (user_id, expires_at),
  INDEX idx_otp_user_created (user_id, created_at)
) ENGINE=InnoDB;

-- Superseded by stateless JWT sessions (see api/config.php) — kept for
-- backward compatibility with any code still referencing it, but new
-- auth code no longer writes to this table.
CREATE TABLE sessions (
  id          CHAR(36)  PRIMARY KEY,
  tenant_id   CHAR(36)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  token_hash  CHAR(64)  NOT NULL,
  expires_at  DATETIME  NOT NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_sessions_token (token_hash),
  INDEX idx_sessions_user (user_id, expires_at)
) ENGINE=InnoDB;

-- JWTs are stateless by design, so "logout" has nothing to delete server
-- side by default. This table lets logout (and, if ever needed, a forced
-- sign-out) actually revoke a token before its natural expiry: every
-- issued JWT carries a `jti`, and requireAuth() rejects one found here.
CREATE TABLE revoked_tokens (
  jti         CHAR(36)  PRIMARY KEY,
  user_id     CHAR(36)  NOT NULL,
  expires_at  DATETIME  NOT NULL,          -- copy of the JWT's own exp, so this row can be purged once it's moot anyway
  revoked_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_revoked_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_revoked_expiry (expires_at)     -- for a cleanup cron: DELETE FROM revoked_tokens WHERE expires_at < NOW()
) ENGINE=InnoDB;

-- Desktop sync agent connection info, per tenant. agent_key is how the
-- agent authenticates (see requireAgent() in config.php) — a separate
-- credential from user JWTs, generated once by
-- api/settings/tally-connection.php and never rotated silently.
CREATE TABLE tally_connections (
  tenant_id          CHAR(36)     PRIMARY KEY,
  host                VARCHAR(255) NOT NULL,
  port                INT          NULL,
  agent_key           CHAR(64)     NOT NULL,
  status              ENUM('connected','disconnected','error') NOT NULL DEFAULT 'disconnected',
  last_connected_at   DATETIME     NULL,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tally_parties (
  id             CHAR(36)     PRIMARY KEY,
  tenant_id      CHAR(36)     NOT NULL,
  ledger_name    VARCHAR(200) NOT NULL,
  balance        DECIMAL(14,2) NOT NULL DEFAULT 0,
  last_synced_at DATETIME     NULL,
  CONSTRAINT fk_tp_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE KEY uq_tp_tenant_ledger (tenant_id, ledger_name)
) ENGINE=InnoDB;

CREATE TABLE customers (
  id               CHAR(36)     PRIMARY KEY,
  tenant_id        CHAR(36)     NOT NULL,
  tally_party_id   CHAR(36)     NULL,
  name             VARCHAR(150) NOT NULL,
  address          VARCHAR(255) NULL,
  phone            VARCHAR(15)  NULL,
  gps_lat          DECIMAL(9,6) NULL,
  gps_lng          DECIMAL(9,6) NULL,
  assigned_rep_id  CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_cust_party  FOREIGN KEY (tally_party_id) REFERENCES tally_parties(id) ON DELETE SET NULL,
  CONSTRAINT fk_cust_rep    FOREIGN KEY (assigned_rep_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cust_rep (assigned_rep_id)
) ENGINE=InnoDB;

-- scheduled_date fixes Defect 3: without it, an unvisited stop can't be
-- queried for any day but "today" (server clock), and a stop still open
-- from a prior day silently disappears from every list.
CREATE TABLE visits (
  id              CHAR(36)  PRIMARY KEY,
  tenant_id       CHAR(36)  NOT NULL,
  rep_id          CHAR(36)  NOT NULL,
  customer_id     CHAR(36)  NOT NULL,
  scheduled_date  DATE      NOT NULL DEFAULT (CURRENT_DATE),
  status          ENUM('not_visited','checked_in','completed') NOT NULL DEFAULT 'not_visited',
  checkin_time    DATETIME  NULL,
  checkin_gps_lat DECIMAL(9,6) NULL,
  checkin_gps_lng DECIMAL(9,6) NULL,
  photo_url       VARCHAR(500) NULL,
  notes           TEXT      NULL,
  created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_visits_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_rep    FOREIGN KEY (rep_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_visits_cust   FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  INDEX idx_visits_rep_scheduled (rep_id, scheduled_date),
  INDEX idx_visits_tenant_scheduled (tenant_id, scheduled_date)
) ENGINE=InnoDB;

CREATE TABLE products (
  id         CHAR(36)     PRIMARY KEY,
  tenant_id  CHAR(36)     NOT NULL,
  name       VARCHAR(150) NOT NULL,
  unit       VARCHAR(20)  NULL,
  CONSTRAINT fk_products_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE field_transactions (
  id               CHAR(36)  PRIMARY KEY,
  tenant_id        CHAR(36)  NOT NULL,
  visit_id         CHAR(36)  NOT NULL,
  client_ref       CHAR(36)  NULL,          -- client-generated idempotency key, see api/field-transactions/create.php
  type             ENUM('order','collection','note') NOT NULL,
  amount           DECIMAL(14,2) NULL,
  items_json       JSON      NULL,
  payment_mode     VARCHAR(20) NULL,
  reference_no     VARCHAR(60) NULL,
  notes            TEXT      NULL,
  follow_up        TINYINT(1) NOT NULL DEFAULT 0,
  sync_status      ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
  tally_voucher_id VARCHAR(60) NULL,
  claimed_by       VARCHAR(120) NULL,
  claimed_at       DATETIME  NULL,
  attempt_count    TINYINT   NOT NULL DEFAULT 0,
  error_message    VARCHAR(500) NULL,
  created_at       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ft_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_ft_visit  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ft_client_ref (tenant_id, client_ref),
  INDEX idx_ft_sync (tenant_id, sync_status),
  INDEX idx_ft_tenant_created (tenant_id, created_at)   -- fixes Defect 8 (activity-feed filesort)
) ENGINE=InnoDB;

CREATE TABLE attendance (
  id            CHAR(36)  PRIMARY KEY,
  tenant_id     CHAR(36)  NOT NULL,
  user_id       CHAR(36)  NOT NULL,
  date          DATE      NOT NULL,
  checkin_time  DATETIME  NULL,
  checkout_time DATETIME  NULL,
  gps_lat       DECIMAL(9,6) NULL,
  gps_lng       DECIMAL(9,6) NULL,
  CONSTRAINT fk_att_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_att_user_date (user_id, date)
) ENGINE=InnoDB;

CREATE TABLE sync_log (
  id            CHAR(36)  PRIMARY KEY,
  tenant_id     CHAR(36)  NOT NULL,
  direction     ENUM('push','pull') NOT NULL,
  payload       JSON      NULL,
  status        ENUM('success','error') NOT NULL,
  error_message VARCHAR(500) NULL,
  created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sync_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_sync_tenant_time (tenant_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  id         CHAR(36)  PRIMARY KEY,
  tenant_id  CHAR(36)  NOT NULL,
  user_id    CHAR(36)  NOT NULL,
  type       VARCHAR(40) NOT NULL,
  message    VARCHAR(255) NOT NULL,
  read_at    DATETIME  NULL,
  created_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, read_at)
) ENGINE=InnoDB;
