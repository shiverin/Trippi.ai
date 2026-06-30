import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.v3_photos.title': "Fotoğraflar 3.0'da taşındı",
  'system_notice.v3_photos.body':
    "Seyahat Planlayıcı'daki **Fotoğraflar** kaldırıldı. Fotoğraflarınız güvende — trippi.ai Immich veya Synology kütüphanenizi asla değiştirmedi.\\n\\nFotoğraflar artık **Journey** eklentisinde. Journey isteğe bağlıdır — henüz kullanılamıyorsa yöneticinizden Yönetici → Eklentiler bölümünden etkinleştirmesini isteyin.",
  'system_notice.v3_journey.title': 'Journey ile tanışın — seyahat günlüğü',
  'system_notice.v3_journey.body':
    'Seyahatlerinizi zaman çizelgeleri, fotoğraf galerileri ve etkileşimli haritalarla zengin hikâyelere dönüştürün.',
  'system_notice.v3_journey.cta_label': "Journey'i Aç",
  'system_notice.v3_journey.highlight_timeline': 'Gün gün zaman çizelgesi ve galeri',
  'system_notice.v3_journey.highlight_photos': "Immich veya Synology'den içe Aktar",
  'system_notice.v3_journey.highlight_share': 'Herkese açık paylaş — giriş gerekmez',
  'system_notice.v3_journey.highlight_export': 'PDF fotoğraf kitabı Olarak dışa aktar',
  'system_notice.v3_features.title': "3.0'Daki diğer öne çıkanlar",
  'system_notice.v3_features.body': 'Bu sürüm hakkında bilmeniz gereken birkaç şey daha.',
  'system_notice.v3_features.highlight_dashboard': 'Mobil öncelikli gösterge paneli yenilemesi',
  'system_notice.v3_features.highlight_offline': 'PWA olarak tam çevrimdışı mod',
  'system_notice.v3_features.highlight_search': 'Gerçek zamanlı yer arama otomatik tamamlama',
  'system_notice.v3_features.highlight_import': 'KMZ/KML dosyalarından yer İçe aktarma',
  'system_notice.v3_mcp.title': 'MCP: OAuth 2.1 yükseltmesi',
  'system_notice.v3_mcp.body':
    'MCP entegrasyonu tamamen yenilendi. OAuth 2.1 artık önerilen kimlik doğrulama yöntemidir. Eski statik jetonlar (trippi_…) kullanımdan kaldırıldı ve gelecekteki bir sürümde kaldırılacak.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 önerilir (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 ayrıntılı izin kapsamı',
  'system_notice.v3_mcp.highlight_deprecated': 'Statik trippi_ jetonları kullanımdan kaldırıldı',
  'system_notice.v3_mcp.highlight_tools': 'Genişletilmiş araç seti ve istemler',
  'system_notice.v3_thankyou.title': 'Benden kişisel bir not',
  'system_notice.v3_thankyou.body':
    'Devam etmeden önce — teşekkür ederim. trippi.ai kendi seyahatlerim için yaptığım bir planlayıcı olarak başladı; bu topluluk onu issue’lar, çeviriler, fikirler ve gerçek yolculuklarla şekillendirdi.\n\ntrippi.ai büyüdükçe bazı bölümler barındırılan hizmetlere veya ücretli planlara dönüşebilir, böylece proje gelişmeye devam eder. Bu değişiklikleri net tutacağım ve daha iyi seyahat planlamasına odaklayacağım.\n\n[Discord topluluğuna katıl](https://discord.gg/7Q6M6jDwzf)',
  'system_notice.v3014_whitespace_collision.title': 'İşlem gerekli: kullanıcı hesabı çakışması',
  'system_notice.v3014_whitespace_collision.body':
    '3.0.14 yükseltmesi, kayıtlı hesaplardaki baştaki/sondaki boşluklardan kaynaklanan bir veya daha fazla kullanıcı adı veya e-posta çakışması tespit etti. Etkilenen hesaplar otomatik olarak yeniden adlandırıldı. Hangi hesapların incelenmesi gerektiğini belirlemek için sunucu günlüklerinde **[migration] WHITESPACE COLLISION** ile başlayan satırlara bakın.',
  'system_notice.welcome_v1.title': "trippi.ai'e hoş Geldiniz",
  'system_notice.welcome_v1.body':
    'Hepsi bir arada seyahat planlayıcınız. Program oluşturun, seyahatleri arkadaşlarınızla paylaşın ve çevrimiçi veya çevrimdışı düzenli kalın.',
  'system_notice.welcome_v1.cta_label': 'Seyahat planla',
  'system_notice.welcome_v1.hero_alt': 'trippi.ai planlama arayüzü kaplamalı manzaralı bir seyahat destinasyonu',
  'system_notice.welcome_v1.highlight_plan': 'Her seyahat için gün gün programlar',
  'system_notice.welcome_v1.highlight_share': 'Seyahat partnerleriyle işbirliği',
  'system_notice.welcome_v1.highlight_offline': 'Mobilde çevrimdışı çalışır',
  'system_notice.dev_test_modal.title': '[Dev] Test bildirimi',
  'system_notice.dev_test_modal.body': 'Bu yalnızca geliştirme ortamına özel bir test bildirimidir.',
  'system_notice.pager.prev': 'Önceki bildirim',
  'system_notice.pager.next': 'Sonraki bildirim',
  'system_notice.pager.counter': '{güncel} / {toplam}',
  'system_notice.pager.goto': '{n}. bildirime git',
  'system_notice.pager.position': '{total} Bildirimden {current}.',
};
export default system_notice;
