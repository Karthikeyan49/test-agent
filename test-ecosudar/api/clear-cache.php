<?php
// Temporary script to clear PHP OpCache
// Delete this file after use for security

if (function_exists('opcache_reset')) {
    opcache_reset();
    echo json_encode([
        'success' => true,
        'message' => 'OpCache cleared successfully!',
        'timestamp' => date('Y-m-d H:i:s')
    ]);
} else {
    echo json_encode([
        'success' => false,
        'message' => 'OpCache is not enabled on this server',
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}