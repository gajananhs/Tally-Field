<?php
// POST /api/agent/result.php
// { id, status: synced|failed, tally_voucher_id?, error_message? }
// Reports what happened to one transaction the agent pulled and pushed
// to Tally. Also logs to sync_log for the Settings screen's history.
require __DIR__ . '/../config.php';

$agent = requireAgent($pdo);
$body = json_body();
$id = $body['id'] ?? '';
$status = $body['status'] ?? '';

if (!in_array($status, ['synced', 'failed'], true)) {
    respond(422, ['error' => 'status_invalid']);
}

// Ownership check: only touch rows belonging to this tenant, whether or
// not this exact agent instance is the one that claimed it — a restart
// mid-run shouldn't orphan a result the agent still has in hand.
$stmt = $pdo->prepare('SELECT id, attempt_count FROM field_transactions WHERE id = ? AND tenant_id = ?');
$stmt->execute([$id, $agent['tenant_id']]);
$row = $stmt->fetch();
if (!$row) {
    respond(404, ['error' => 'not_found']);
}

if ($status === 'synced') {
    $pdo->prepare(
        'UPDATE field_transactions
         SET sync_status = "synced", tally_voucher_id = ?, error_message = NULL, claimed_by = NULL, claimed_at = NULL
         WHERE id = ?'
    )->execute([$body['tally_voucher_id'] ?? null, $id]);
} else {
    $pdo->prepare(
        'UPDATE field_transactions
         SET sync_status = "failed", error_message = ?, attempt_count = attempt_count + 1, claimed_by = NULL, claimed_at = NULL
         WHERE id = ?'
    )->execute([$body['error_message'] ?? 'Unknown error from Tally', $id]);
}

$pdo->prepare(
    'INSERT INTO sync_log (id, tenant_id, direction, payload, status, error_message, created_at)
     VALUES (?, ?, "push", ?, ?, ?, NOW())'
)->execute([
    uuid(), $agent['tenant_id'],
    json_encode(['field_transaction_id' => $id, 'tally_voucher_id' => $body['tally_voucher_id'] ?? null]),
    $status === 'synced' ? 'success' : 'error',
    $body['error_message'] ?? null,
]);

respond(200, ['ok' => true]);
