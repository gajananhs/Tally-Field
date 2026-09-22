<?php
// GET /api/visits/list.php?date=2026-09-22
// Fix for QA Defect 3: filters on scheduled_date, not a COALESCE(checkin_time, NOW())
// hack that broke unvisited stops on any day but today.
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'rep');
$date = $_GET['date'] ?? date('Y-m-d');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    respond(422, ['error' => 'date_invalid']);
}

$stmt = $pdo->prepare(
    'SELECT v.id, v.status, v.checkin_time,
            c.id AS customer_id, c.name AS customer_name, c.address,
            tp.balance, tp.last_synced_at
     FROM visits v
     JOIN customers c ON c.id = v.customer_id
     LEFT JOIN tally_parties tp ON tp.id = c.tally_party_id
     WHERE v.tenant_id = ? AND v.rep_id = ? AND v.scheduled_date = ?
     ORDER BY v.checkin_time IS NULL DESC, v.checkin_time ASC'
);
$stmt->execute([$session['tenant_id'], $session['user_id'], $date]);

respond(200, ['visits' => $stmt->fetchAll()]);
