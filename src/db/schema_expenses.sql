-- Finance Portal — Phase 3: Expenses and Accounts Payable.
-- Both post against chart_of_accounts/budget_lines, closing the loop Budget (Phase 2)
-- left open — real "actual" spend now exists for non-payroll accounts too.
-- Full Procurement (PO/GRN/three-way matching) is intentionally out of scope here;
-- supplier_invoices.po_reference is a free-text placeholder for that future phase.

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  bank_details TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  financial_year_id TEXT REFERENCES financial_years(id),
  department TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  budget_line_id TEXT REFERENCES budget_lines(id),
  vendor TEXT,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'returned', 'paid', 'cancelled')),
  attachment_url TEXT,
  notes TEXT,
  requested_by TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque')),
  payment_reference TEXT,
  paid_at TIMESTAMPTZ,
  paid_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  financial_year_id TEXT REFERENCES financial_years(id),
  department TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  budget_line_id TEXT REFERENCES budget_lines(id),
  invoice_number TEXT NOT NULL,
  po_reference TEXT,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ETB',
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'partially_paid', 'paid', 'cancelled')),
  attachment_url TEXT,
  notes TEXT,
  created_by TEXT,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL REFERENCES schools(id),
  supplier_invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque')),
  reference TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_school ON expenses(school_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_budget_line ON expenses(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_school ON supplier_invoices(school_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier ON supplier_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_budget_line ON supplier_invoices(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice ON supplier_payments(supplier_invoice_id);
