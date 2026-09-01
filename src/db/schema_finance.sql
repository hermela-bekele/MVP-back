-- Finance Portal — Phase 1 (Foundation): financial years/periods + chart of accounts.
-- Later phases (budget, GL/journals, AP, banking, petty cash) build on these tables.

CREATE TABLE IF NOT EXISTS financial_years (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS financial_periods (
  id TEXT PRIMARY KEY,
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_year_id, name)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  parent_id TEXT REFERENCES chart_of_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, code)
);

CREATE INDEX IF NOT EXISTS idx_financial_years_school ON financial_years(school_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_periods_year ON financial_periods(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_financial_periods_school ON financial_periods(school_id, status);
CREATE INDEX IF NOT EXISTS idx_coa_school ON chart_of_accounts(school_id, account_type);
CREATE INDEX IF NOT EXISTS idx_coa_parent ON chart_of_accounts(parent_id);

-- Phase 2: Budget management — budgets, their line items, and transfers between lines.

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  financial_year_id TEXT NOT NULL REFERENCES financial_years(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'returned', 'closed')),
  version INTEGER NOT NULL DEFAULT 1,
  revised_from_budget_id TEXT REFERENCES budgets(id),
  notes TEXT,
  created_by TEXT,
  submitted_at TIMESTAMPTZ,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  school_id TEXT NOT NULL REFERENCES schools(id),
  department TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  allocated_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_transfers (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  from_line_id TEXT NOT NULL REFERENCES budget_lines(id),
  to_line_id TEXT NOT NULL REFERENCES budget_lines(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budgets_school_year ON budgets(school_id, financial_year_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);
CREATE INDEX IF NOT EXISTS idx_budget_lines_account ON budget_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_budget_transfers_budget ON budget_transfers(budget_id);
