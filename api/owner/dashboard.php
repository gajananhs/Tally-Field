<?php
// GET /api/owner/dashboard.php
require __DIR__ . '/../config.php';

$session = requireAuth($pdo, 'owner');
$tenantId = $session['tenant_id'];

$totalOutstanding = $pdo->prepare('SELECT COALESCE(SUM(balance),0) AS v FROM tally_parties WHERE tenant_id = ?');
$totalOutstanding->execute([$tenantId]);

$collectedToday = $pdo->prepare(
    "SELECT COALESCE(SUM(ft.amount),0) AS v FROM field_transactions ft
     WHERE ft.tenant_id = ? AND ft.type = 'collection' AND DATE(ft.created_at) = CURDATE()"
);
$collectedToday->execute([$tenantId]);

$visitsToday = $pdo->prepare(
    'SELECT COUNT(*) AS v FROM visits WHERE tenant_id = ? AND scheduled_date = CURDATE()'
);
$visitsToday->execute([$tenantId]);

$activeReps = $pdo->prepare(
    'SELECT COUNT(DISTINCT user_id) AS v FROM attendance WHERE tenant_id = ? AND date = CURDATE() AND checkout_time IS NULL'
);
$activeReps->execute([$tenantId]);

// Uses idx_ft_tenant_created (QA Defect 8 fix) — bounded to a recent
// window so the index stays a cheap range scan as data grows.
$feed = $pdo->prepare(
    "SELECT u.name AS rep, ft.type AS action, c.name AS customer, ft.amount, ft.created_at AS at
     FROM field_transactions ft
     JOIN visits v ON v.id = ft.visit_id
     JOIN users u ON u.id = v.rep_id
     JOIN customers c ON c.id = v.customer_id
     WHERE ft.tenant_id = ? AND ft.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY ft.created_at DESC LIMIT 20"
);
$feed->execute([$tenantId]);

respond(200, [
    'total_outstanding' => (float) $totalOutstanding->fetch()['v'],
    'collected_today' => (float) $collectedToday->fetch()['v'],
    'visits_today' => (int) $visitsToday->fetch()['v'],
    'active_reps' => (int) $activeReps->fetch()['v'],
    'activity_feed' => $feed->fetchAll(),
]);
