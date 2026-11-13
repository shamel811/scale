<?php
// يُشغَّل مرة واحدة فقط لإنشاء الجداول وحساب مدير المنصة. احذف هذا الملف بعد النجاح.
define('MZ_PRIVATE', getenv('MEZZAN_PRIVATE') ?: dirname(__DIR__, 2) . '/mezzan_private');
header('Content-Type: text/html; charset=utf-8');
function fail($c, $m, $s = 400) { http_response_code($s); echo "<p dir=rtl style='font-family:sans-serif'>⚠️ $m</p>"; exit; }
function out($d) { echo json_encode($d); exit; }
$file = getenv('MEZZAN_CONFIG') ?: (MZ_PRIVATE . '/config.php');
if (!is_file($file)) fail('cfg', 'ملف config.php غير موجود في مجلد mezzan_private. انسخ config.sample.php إليه أولاً.');
$cfg = require $file;
$lock = MZ_PRIVATE . '/installed.lock';
if (is_file($lock)) fail('lock', 'تم الإعداد من قبل. احذف هذا الملف (setup.php) من الخادم.', 403);
$tok = (string) ($_GET['token'] ?? '');
if ($tok === '' || !hash_equals((string) $cfg['setup_token'], $tok) || strpos($cfg['setup_token'], 'ضع-هنا') === 0) {
    fail('tok', 'الرمز غير صحيح. افتح: setup.php?token=قيمة_setup_token_من_config.php', 403);
}
$a = $cfg['admin'];
if (!filter_var($a['email'], FILTER_VALIDATE_EMAIL) || strlen($a['password']) < 10 || strpos($a['password'], 'غيّرها') === 0) {
    fail('adm', 'عدّل بيانات admin في config.php (بريد صحيح وكلمة مرور لا تقل عن 10 أحرف).');
}
$d = $cfg['db'];
try {
    $pdo = new PDO($d['dsn'], $d['user'] ?? null, $d['pass'] ?? null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $drv = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    $sf = MZ_PRIVATE . '/schema' . ($drv === 'sqlite' ? '_sqlite' : '') . '.sql';
    $sql = file_get_contents($sf);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        $pdo->exec($stmt);
    }
    $ex = $pdo->prepare("SELECT id FROM users WHERE email=?");
    $ex->execute([strtolower($a['email'])]);
    if (!$ex->fetch()) {
        $pdo->prepare("INSERT INTO users (tenant_id,role,name,email,pass_hash,active,created_at) VALUES (0,'admin',?,?,?,1,?)")
            ->execute([$a['name'], strtolower($a['email']), password_hash($a['password'], PASSWORD_DEFAULT), time()]);
    }
    file_put_contents($lock, date('c'));
    echo "<p dir=rtl style='font-family:sans-serif'>✅ تم إنشاء الجداول وحساب مدير المنصة (" . htmlspecialchars($a['email']) . ").<br><b>احذف الملف api/setup.php الآن.</b><br>لوحة الإدارة: <a href='/app/admin.html'>/app/admin.html</a></p>";
} catch (Exception $e) {
    error_log('mezzan setup: ' . $e->getMessage());
    fail('db', 'فشل الإعداد: ' . htmlspecialchars($e->getMessage()), 500);
}
