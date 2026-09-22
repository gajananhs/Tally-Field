-- ============================================================
-- TallyField — dev/demo seed data. Never run against production.
-- ============================================================

INSERT INTO tenants (id, name, tally_company, plan) VALUES
('t1', 'Canares Automation Pvt Ltd', 'Canares Group of Company', 'trial');

INSERT INTO users (id, tenant_id, role, name, phone, is_active) VALUES
('u_owner1', 't1', 'owner', 'Gajanan',   '9000000000', 1),
('u_rep1',   't1', 'rep',   'Suresh K.', '9000000001', 1);

INSERT INTO tally_parties (id, tenant_id, ledger_name, balance, last_synced_at) VALUES
('tp1', 't1', 'Bharat Filtration Co.',   84200.00, NOW()),
('tp2', 't1', 'Shree Valves & Fittings',     0.00, NOW()),
('tp3', 't1', 'Konkan Pneumatics',      216500.00, NOW());

INSERT INTO customers (id, tenant_id, tally_party_id, name, address, phone, assigned_rep_id) VALUES
('c1', 't1', 'tp1', 'Bharat Filtration Co.',   'Peenya Industrial Area, Bangalore', '9876500001', 'u_rep1'),
('c2', 't1', 'tp2', 'Shree Valves & Fittings', 'Dabaspet, Bangalore',               '9876500002', 'u_rep1'),
('c3', 't1', 'tp3', 'Konkan Pneumatics',       'Hubli Industrial Estate',           '9876500003', 'u_rep1');

INSERT INTO visits (id, tenant_id, rep_id, customer_id, scheduled_date, status) VALUES
('v1', 't1', 'u_rep1', 'c1', CURDATE(), 'not_visited'),
('v2', 't1', 'u_rep1', 'c2', CURDATE(), 'not_visited'),
('v3', 't1', 'u_rep1', 'c3', CURDATE(), 'not_visited');

INSERT INTO products (id, tenant_id, name, unit) VALUES
('p1', 't1', 'SS Push-Fit Elbow 1/2"', 'pcs'),
('p2', 't1', 'QUICKAIR Aluminium Profile 40x40', 'm');
