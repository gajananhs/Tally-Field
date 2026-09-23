<?php
// GET /api/agent/pull.php
// Called by the desktop sync agent, authenticated with X-Agent-Key (or
// ?key=), never a user JWT. Returns pending field_transactions for this
// tenant and atomically claims them so a second agent instance (or a
// re-run before the first finished) can't double-process the same row.
require __DIR__ . '/../config.php';

$agent = requireAgent($pdo);
$hostname = substr(trim($_GET['hostname'] ?? 'unknown-agent'), 0, 60); // claimed_by is VARCHAR(120); leave room for the '#'+uuid suffix

// Claim first, read back what was actually claimed — this two-step
// UPDATE-then-SELECT is the atomic part: the WHERE clause only matches
// rows nobody has claimed yet, so a race between two agent runs can
// claim different rows but never the same one twice.
$claimId = uuid();
$pdo->prepare(
    "UPDATE field_transactions
     SET claimed_by = ?, claimed_at = NOW()
     WHERE tenant_id = ? AND sync_status = 'pending' AND claimed_by IS NULL
     LIMIT 50"
)->execute([$hostname . '#' . $claimId, $agent['tenant_id']]);

$stmt = $pdo->prepare(
    "SELECT ft.id, ft.type, ft.amount, ft.items_json, ft.payment_mode, ft.reference_no, ft.notes,
            c.name AS customer_name, tp.ledger_name
     FROM field_transactions ft
     JOIN visits v ON v.id = ft.visit_id
     JOIN customers c ON c.id = v.customer_id
     LEFT JOIN tally_parties tp ON tp.id = c.tally_party_id
     WHERE ft.tenant_id = ? AND ft.claimed_by = ?"
);
$stmt->execute([$agent['tenant_id'], $hostname . '#' . $claimId]);
$rows = $stmt->fetchAll();

foreach ($rows as &$r) {
    if ($r['items_json']) $r['items_json'] = json_decode($r['items_json'], true);
}

respond(200, ['transactions' => $rows]);
