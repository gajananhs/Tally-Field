<?php
// POST /api/auth/logout.php
require __DIR__ . '/../config.php';

$header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (preg_match('/Bearer\s+(\S+)/', $header, $m)) {
    $pdo->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $m[1])]);
}
respond(200, ['ok' => true]);
