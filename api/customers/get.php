<?php
// GET /api/customers/get.php?id=c1
require __DIR__ . '/../config.php';

$session = requireAuth($pdo);
$id = $_GET['id'] ?? '';

$sql = 'SELECT c.id, c.name, c.address, c.phone, tp.balance, tp.last_synced_at
        FROM customers c LEFT JOIN tally_parties tp ON tp.id = c.tally_party_id
        WHERE c.id = ? AND c.tenant_id = ?';
$params = [$id, $session['tenant_id']];

// Access rule: a rep only sees their own assigned customers.
if ($session['role'] === 'rep') {
    $sql .= ' AND c.assigned_rep_id = ?';
    $params[] = $session['user_id'];
}

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$customer = $stmt->fetch();

if (!$customer) {
    respond(404, ['error' => 'customer_not_found']);
}

respond(200, $customer);
