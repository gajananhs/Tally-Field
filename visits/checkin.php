<?php
// POST /api/visits/checkin.php  { customer_id, gps_lat, gps_lng, photo_base64? }
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'rep');
$body = json_body();
$customerId = $body['customer_id'] ?? '';

if ($customerId === '') {
    respond(422, ['error' => 'customer_id_required']);
}

// Fix for QA Defect 9a: guard photo size before touching it.
if (!empty($body['photo_base64']) && strlen($body['photo_base64']) > 4_000_000) {
    respond(413, ['error' => 'photo_too_large', 'message' => 'Photo is too large — try a lower-resolution shot']);
}

$stmt = $pdo->prepare('SELECT id FROM customers WHERE id = ? AND tenant_id = ? AND assigned_rep_id = ?');
$stmt->execute([$customerId, $session['tenant_id'], $session['user_id']]);
if (!$stmt->fetch()) {
    respond(404, ['error' => 'customer_not_found']);
}

// Fix for QA Defect 9b: don't create a second visit row for the same
// customer/day if the rep double-taps or the client retries.
$dup = $pdo->prepare(
    'SELECT id, status FROM visits
     WHERE tenant_id = ? AND rep_id = ? AND customer_id = ? AND scheduled_date = CURDATE()'
);
$dup->execute([$session['tenant_id'], $session['user_id'], $customerId]);
if ($existing = $dup->fetch()) {
    if ($existing['status'] === 'not_visited') {
        $pdo->prepare(
            'UPDATE visits SET status = "checked_in", checkin_time = NOW(),
             checkin_gps_lat = ?, checkin_gps_lng = ? WHERE id = ?'
        )->execute([$body['gps_lat'] ?? null, $body['gps_lng'] ?? null, $existing['id']]);
    }
    respond(200, ['id' => $existing['id'], 'status' => 'checked_in']);
}

$photoUrl = null;
if (!empty($body['photo_base64'])) {
    // BACKEND: decode + store to object storage, return a signed URL.
    // $photoUrl = storePhoto($body['photo_base64'], $session['tenant_id']);
}

$id = uuid();
$pdo->prepare(
    'INSERT INTO visits (id, tenant_id, rep_id, customer_id, scheduled_date, status, checkin_time, checkin_gps_lat, checkin_gps_lng, photo_url)
     VALUES (?, ?, ?, ?, CURDATE(), "checked_in", NOW(), ?, ?, ?)'
)->execute([
    $id, $session['tenant_id'], $session['user_id'], $customerId,
    $body['gps_lat'] ?? null, $body['gps_lng'] ?? null, $photoUrl,
]);

respond(201, ['id' => $id, 'status' => 'checked_in']);
