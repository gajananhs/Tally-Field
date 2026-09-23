<?php
// POST /api/agent/balances.php
// { tally_status: connected|error, error_message?, parties: [{ledger_name, balance}, ...] }
// The pull-direction half of the sync: the agent reads ledger balances
// out of Tally and pushes them here. This is what actually populates
// tally_parties.balance — until an agent successfully calls this at
// least once, every customer's "Outstanding" in the app is whatever
// schema.sql/seed.sql happened to put there, not real Tally data.
require __DIR__ . '/../config.php';

$agent = requireAgent($pdo);
$body = json_body();
$tenantId = $agent['tenant_id'];
$tallyStatus = $body['tally_status'] ?? 'error';
$parties = $body['parties'] ?? [];

// Every successful call (even with zero parties) proves the agent
// reached this API — but only a tally_status of "connected" proves the
// agent also reached Tally itself. Keep those two facts distinct rather
// than conflating "API is up" with "Tally is up".
$pdo->prepare(
    'INSERT INTO tally_connections (tenant_id, host, port, agent_key, status, last_connected_at, updated_at)
     SELECT tenant_id, host, port, agent_key, ?, NOW(), NOW() FROM tally_connections WHERE tenant_id = ?
     ON DUPLICATE KEY UPDATE status = VALUES(status), last_connected_at = VALUES(last_connected_at), updated_at = NOW()'
)->execute([$tallyStatus === 'connected' ? 'connected' : 'error', $tenantId]);

$updated = 0;
if (is_array($parties)) {
    $upsert = $pdo->prepare(
        'INSERT INTO tally_parties (id, tenant_id, ledger_name, balance, last_synced_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE balance = VALUES(balance), last_synced_at = NOW()'
    );
    foreach ($parties as $p) {
        $ledgerName = trim($p['ledger_name'] ?? '');
        if ($ledgerName === '' || !isset($p['balance']) || !is_numeric($p['balance'])) continue;
        $upsert->execute([uuid(), $tenantId, $ledgerName, $p['balance']]);
        $updated++;
    }
}

$pdo->prepare(
    'INSERT INTO sync_log (id, tenant_id, direction, payload, status, error_message, created_at)
     VALUES (?, ?, "pull", ?, ?, ?, NOW())'
)->execute([
    uuid(), $tenantId, json_encode(['parties_received' => count($parties), 'parties_updated' => $updated]),
    $tallyStatus === 'connected' ? 'success' : 'error',
    $body['error_message'] ?? null,
]);

respond(200, ['ok' => true, 'parties_updated' => $updated]);
