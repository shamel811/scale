-- MySQL 5.7+/MariaDB 10.3+ (utf8mb4). Import once from phpMyAdmin, or let api/setup.php create it.
CREATE TABLE IF NOT EXISTS tenants (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ok',          -- ok | suspended
  plan VARCHAR(20) NULL,
  trial_ends_at BIGINT NOT NULL,
  period_end BIGINT NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL DEFAULT 0,
  role VARCHAR(10) NOT NULL,                          -- owner | seller | admin
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL UNIQUE,
  username VARCHAR(60) NULL UNIQUE,
  pass_hash VARCHAR(255) NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  INDEX (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS docs (
  tenant_id INT UNSIGNED NOT NULL,
  parent VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  data MEDIUMTEXT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, parent, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  plan VARCHAR(20) NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency VARCHAR(5) NOT NULL DEFAULT 'EGP',
  reference VARCHAR(60) NOT NULL UNIQUE,
  paymob_order_id VARCHAR(40) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',      -- pending | paid | failed | refunded | manual
  created_at BIGINT NOT NULL,
  paid_at BIGINT NULL,
  note VARCHAR(255) NULL,
  INDEX (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS login_attempts (
  k VARCHAR(190) NOT NULL,
  ts BIGINT NOT NULL,
  INDEX (k, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS resets (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
