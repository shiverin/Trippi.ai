import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.v3_photos.title': 'تم نقل الصور في الإصدار 3.0',
  'system_notice.v3_photos.body':
    'تمت إزالة تبويب ​**الصور**​ من مخطط الرحلة. صورك آمنة — لم يعدّل trippi.ai مكتبتك على Immich أو Synology قطّ.\n\nتعيش الصور الآن في إضافة **Journey**. Journey اختيارية — إن لم تكن متاحة بعد، اطلب من المسؤول تفعيلها عبر Admin ← الإضافات.',
  'system_notice.v3_journey.title': 'تعرّف على Journey — مذكرة سفر',
  'system_notice.v3_journey.body': 'وثّق رحلاتك كقصص غنية بخطوط زمنية ومعارض صور وخرائط تفاعلية.',
  'system_notice.v3_journey.cta_label': 'فتح Journey',
  'system_notice.v3_journey.highlight_timeline': 'جدول زمني يومي ومعرض',
  'system_notice.v3_journey.highlight_photos': 'استيراد من Immich أو Synology',
  'system_notice.v3_journey.highlight_share': 'مشاركة علنية — دون تسجيل دخول',
  'system_notice.v3_journey.highlight_export': 'تصدير كألبوم صور PDF',
  'system_notice.v3_features.title': 'مزيد من مميزات 3.0',
  'system_notice.v3_features.body': 'بعض الجديد الآخر الجدير بالمعرفة في هذا الإصدار.',
  'system_notice.v3_features.highlight_dashboard': 'إعادة تصميم لوحة التحكم mobile-first',
  'system_notice.v3_features.highlight_offline': 'وضع لا اتصال كامل كتطبيق PWA',
  'system_notice.v3_features.highlight_search': 'إكمال تلقائي في الوقت الفعلي',
  'system_notice.v3_features.highlight_import': 'استيراد أماكن من ملفات KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: ترقية OAuth 2.1',
  'system_notice.v3_mcp.body':
    'تمت إعادة تصميم تكامل MCP بالكامل. OAuth 2.1 هو الآن طريقة المصادقة الموصى بها. الرموز الثابتة (trippi_…) مهملة وستُزال في إصدار مستقبلي.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 موصى به (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 نطاق أذونات دقيق',
  'system_notice.v3_mcp.highlight_deprecated': 'الرموز الثابتة trippi_ مهملة',
  'system_notice.v3_mcp.highlight_tools': 'مجموعة أدوات وإرشادات موسعة',
  'system_notice.v3_thankyou.title': 'كلمة شخصية مني',
  'system_notice.v3_thankyou.body':
    "قبل أن تتابع — شكرًا لك. بدأ trippi.ai كمخطط لرحلاتي الخاصة، وقد شكّله هذا المجتمع عبر البلاغات والترجمات والأفكار والرحلات الحقيقية.\n\nمع نمو trippi.ai، قد تتطور بعض الأجزاء إلى خدمات مستضافة أو خطط مدفوعة حتى يستمر المشروع في التحسن. سأبقي هذه التغييرات واضحة ومركزة على تخطيط سفر أفضل.\n\n[انضم إلى المجتمع على Discord](https://discord.gg/7Q6M6jDwzf)",
  'system_notice.v3014_whitespace_collision.title': 'إجراء مطلوب: تعارض في حسابات المستخدمين',
  'system_notice.v3014_whitespace_collision.body':
    'اكتشف ترقية 3.0.14 تعارضًا في أسماء مستخدمين أو بريد إلكتروني ناتجًا عن مسافات بيضاء في بداية أو نهاية القيم المخزنة. تمت إعادة تسمية الحسابات المتأثرة تلقائيًا. تحقق من سجلات الخادم بحثًا عن أسطر تبدأ بـ **[migration] WHITESPACE COLLISION** لتحديد الحسابات التي تحتاج إلى مراجعة.',
  'system_notice.welcome_v1.title': 'مرحبًا بك في trippi.ai',
  'system_notice.welcome_v1.body':
    'مخطط رحلاتك الشامل. أنشئ جداول السفر، وشارك رحلاتك مع الأصدقاء، وابقَ منظمًا — سواء كنت متصلاً بالإنترنت أم لا.',
  'system_notice.welcome_v1.cta_label': 'خطط لرحلة',
  'system_notice.welcome_v1.hero_alt': 'وجهة سفر خلابة مع واجهة تطبيق trippi.ai',
  'system_notice.welcome_v1.highlight_plan': 'جداول رحلات يومية لكل سفرة',
  'system_notice.welcome_v1.highlight_share': 'تعاون مع شركاء السفر',
  'system_notice.welcome_v1.highlight_offline': 'يعمل بلا إنترنت على الهاتف',
  'system_notice.pager.prev': 'الإشعار السابق',
  'system_notice.pager.next': 'الإشعار التالي',
  'system_notice.pager.goto': 'الانتقال إلى الإشعار {n}',
  'system_notice.pager.position': 'الإشعار {current} من {total}',
  'system_notice.dev_test_modal.title': '[Dev] Test notice', // en-fallback
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.', // en-fallback
  'system_notice.pager.counter': '{current} / {total}', // en-fallback
};
export default system_notice;
