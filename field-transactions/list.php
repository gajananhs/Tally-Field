<?php
// GET /api/field-transactions/list.php
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'rep');

$stmt = $pdo->prepare(
    "SELECT ft.id, ft.type, ft.amount, ft.sync_status, ft.error_message, ft.created_at,
            c.name AS customer
     FROM field_transactions ft
     JOIN visits v ON v.id = ft.visit_id
     JOIN customers c ON c.id = v.customer_id
     WHERE ft.tenant_id = ? AND v.rep_id = ?
     ORDER BY ft.created_at DESC LIMIT 100"
);
$stmt->execute([$session['tenant_id'], $session['user_id']]);

respond(200, ['field_transactions' => $stmt->fetchAll()]);
