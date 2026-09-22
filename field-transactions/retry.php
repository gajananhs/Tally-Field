<?php
// POST /api/field-transactions/retry.php  { id }
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'rep');
$body = json_body();
$id = $body['id'] ?? '';

$stmt = $pdo->prepare(
    'SELECT ft.id FROM field_transactions ft
     JOIN visits v ON v.id = ft.visit_id
     WHERE ft.id = ? AND ft.tenant_id = ? AND v.rep_id = ? AND ft.sync_status = "failed"'
);
$stmt->execute([$id, $session['tenant_id'], $session['user_id']]);
if (!$stmt->fetch()) {
    respond(404, ['error' => 'not_found']);
}

$pdo->prepare(
    'UPDATE field_transactions
     SET sync_status = "pending", attempt_count = attempt_count + 1, claimed_by = NULL, claimed_at = NULL, error_message = NULL
     WHERE id = ?'
)->execute([$id]);

$row = $pdo->prepare('SELECT attempt_count FROM field_transactions WHERE id = ?');
$row->execute([$id]);

respond(200, ['id' => $id, 'sync_status' => 'pending', 'attempt_count' => $row->fetch()['attempt_count']]);
