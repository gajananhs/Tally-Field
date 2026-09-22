<?php
// POST /api/field-transactions/create.php
// { visit_id, type: order|collection|note, client_ref,
//   amount?, items_json?, payment_mode?, reference_no?, notes?, follow_up? }
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'rep');
$body = json_body();

$visitId = $body['visit_id'] ?? '';
$type = $body['type'] ?? '';
$clientRef = $body['client_ref'] ?? '';

if (!in_array($type, ['order', 'collection', 'note'], true)) {
    respond(422, ['error' => 'type_invalid']);
}
if ($clientRef === '') {
    respond(422, ['error' => 'client_ref_required', 'message' => 'Client must send a unique idempotency key']);
}

// Fix for QA Defect 2: validation now matches what the front end actually
// collects per type — Order needs items, not an amount; Collection needs
// an amount; Note needs neither.
if ($type === 'collection') {
    if (!isset($body['amount']) || !is_numeric($body['amount']) || $body['amount'] <= 0) {
        respond(422, ['error' => 'amount_invalid', 'message' => 'Enter a valid amount']);
    }
} elseif ($type === 'order') {
    if (empty($body['items_json']) || !is_array($body['items_json'])) {
        respond(422, ['error' => 'items_required', 'message' => 'Add at least one item']);
    }
}

$stmt = $pdo->prepare('SELECT id FROM visits WHERE id = ? AND tenant_id = ? AND rep_id = ?');
$stmt->execute([$visitId, $session['tenant_id'], $session['user_id']]);
if (!$stmt->fetch()) {
    respond(404, ['error' => 'visit_not_found']);
}

// Idempotency: a retried request with the same client_ref (offline queue
// replay, flaky connection) returns the existing row instead of duplicating it.
$dup = $pdo->prepare('SELECT id, sync_status FROM field_transactions WHERE tenant_id = ? AND client_ref = ?');
$dup->execute([$session['tenant_id'], $clientRef]);
if ($existing = $dup->fetch()) {
    respond(200, ['id' => $existing['id'], 'sync_status' => $existing['sync_status']]);
}

$id = uuid();
$pdo->prepare(
    'INSERT INTO field_transactions
       (id, tenant_id, visit_id, client_ref, type, amount, items_json, payment_mode, reference_no, notes, follow_up, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pending")'
)->execute([
    $id, $session['tenant_id'], $visitId, $clientRef, $type,
    $body['amount'] ?? null,
    isset($body['items_json']) ? json_encode($body['items_json']) : null,
    $body['payment_mode'] ?? null,
    $body['reference_no'] ?? null,
    $body['notes'] ?? null,
    !empty($body['follow_up']) ? 1 : 0,
]);

$pdo->prepare('UPDATE visits SET status = "completed" WHERE id = ?')->execute([$visitId]);

// BACKEND: enqueue for the desktop sync agent (XML-over-HTTP, port 9000,
// same atomic claim pattern as CAPL Mobile Apps' Quick Entry).

respond(201, ['id' => $id, 'sync_status' => 'pending', 'created_at' => date('c')]);
