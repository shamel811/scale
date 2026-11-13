<?php
// انسخ هذا الملف إلى config.php في نفس المجلد (mezzan_private) وعدّل القيم.
// يجب أن يكون المجلد خارج public_html. لا ترفع config.php إلى أي مستودع عام.
return [
  'db' => [
    'dsn'  => 'mysql:host=localhost;dbname=DBNAME;charset=utf8mb4',
    'user' => 'DBUSER',
    'pass' => 'DBPASS',
  ],
  'app_url'       => 'https://mezzanflow.com',   // بدون / في النهاية
  'cookie_secure' => true,                        // اتركها true مع HTTPS
  'trial_days'    => 7,
  'max_sellers'   => 10,                          // أقصى عدد موظفين لكل عميل
  'support'       => ['whatsapp' => '', 'email' => ''],   // يظهر للعميل للتواصل (واتساب بصيغة 2010xxxxxxx)
  'setup_token'   => 'ضع-هنا-كلمة-طويلة-عشوائية', // تُستخدم مرة واحدة مع setup.php
  'admin' => [                                    // حساب مدير المنصة (يُنشأ في setup.php)
    'name' => 'مدير المنصة', 'email' => 'admin@example.com', 'password' => 'غيّرها-كلمة-مرور-قوية',
  ],
  // الخطط. الأسعار بالجنيه المصري. اجعل 'enabled' => false لإخفاء خطة.
  'plans' => [
    'monthly'    => ['label' => 'شهري',      'months' => 1,  'price' => 299,  'enabled' => true],
    'quarterly'  => ['label' => 'ربع سنوي',  'months' => 3,  'price' => 849,  'enabled' => true],
    'semiannual' => ['label' => 'نصف سنوي',  'months' => 6,  'price' => 1599, 'enabled' => true],
    'annual'     => ['label' => 'سنوي',      'months' => 12, 'price' => 2999, 'enabled' => true],
  ],
  'paymob' => [
    'enabled'         => false,                   // فعّلها بعد إدخال المفاتيح
    'secret_key'      => '',                      // egy_sk_...
    'public_key'      => '',                      // egy_pk_...
    'hmac_secret'     => '',                      // من لوحة Paymob > Settings
    'integration_ids' => [],                      // أرقام تكامل البطاقة/المحفظة، مثل [123456]
    'currency'        => 'EGP',
    'checkout_base'   => 'https://accept.paymob.com/unifiedcheckout/',   // غيّره فقط إن اختلف رابط الدفع الموحّد في حسابك
  ],
];
