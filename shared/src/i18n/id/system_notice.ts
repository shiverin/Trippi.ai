import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Selamat datang di trippi.ai',
  'system_notice.welcome_v1.body':
    'Perencana perjalanan lengkap Anda. Buat itinerari, bagikan perjalanan dengan teman, dan tetap terorganisir — online maupun offline.',
  'system_notice.welcome_v1.cta_label': 'Rencanakan perjalanan',
  'system_notice.welcome_v1.hero_alt': 'Destinasi wisata indah dengan antarmuka trippi.ai',
  'system_notice.welcome_v1.highlight_plan': 'Itinerari harian untuk setiap perjalanan',
  'system_notice.welcome_v1.highlight_share': 'Berkolaborasi dengan teman perjalanan',
  'system_notice.welcome_v1.highlight_offline': 'Bekerja offline di ponsel',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Pemberitahuan sebelumnya',
  'system_notice.pager.next': 'Pemberitahuan berikutnya',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Pergi ke pemberitahuan {n}',
  'system_notice.pager.position': 'Pemberitahuan {current} dari {total}',
  'system_notice.v3_photos.title': 'Foto dipindahkan di 3.0',
  'system_notice.v3_photos.body':
    '**Foto** di Perencana Perjalanan telah dihapus. Foto Anda aman — trippi.ai tidak pernah mengubah perpustakaan Immich atau Synology Anda.\n\nFoto kini ada di addon **Journey**. Journey bersifat opsional — jika belum tersedia, minta admin untuk mengaktifkannya di Admin → Addon.',
  'system_notice.v3_journey.title': 'Kenali Journey — jurnal perjalanan',
  'system_notice.v3_journey.body':
    'Dokumentasikan perjalanan Anda sebagai cerita hidup dengan linimasa, galeri foto, dan peta interaktif.',
  'system_notice.v3_journey.cta_label': 'Buka Journey',
  'system_notice.v3_journey.highlight_timeline': 'Linimasa & galeri',
  'system_notice.v3_journey.highlight_photos': 'Impor dari Immich atau Synology',
  'system_notice.v3_journey.highlight_share': 'Bagikan secara publik — tanpa login',
  'system_notice.v3_journey.highlight_export': 'Ekspor sebagai buku foto PDF',
  'system_notice.v3_features.title': 'Sorotan lain di 3.0',
  'system_notice.v3_features.body': 'Beberapa pembaruan lain dalam rilis ini.',
  'system_notice.v3_features.highlight_dashboard': 'Desain ulang dashboard mobile-first',
  'system_notice.v3_features.highlight_offline': 'Mode offline penuh sebagai PWA',
  'system_notice.v3_features.highlight_search': 'Pelengkapan otomatis tempat secara real-time',
  'system_notice.v3_features.highlight_import': 'Impor tempat dari file KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: pembaruan OAuth 2.1',
  'system_notice.v3_mcp.body':
    'Integrasi MCP telah sepenuhnya diperbarui. OAuth 2.1 kini menjadi metode autentikasi yang direkomendasikan. Token statis (trippi_…) sudah usang dan akan dihapus pada versi mendatang.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 direkomendasikan (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 cakupan izin yang terperinci',
  'system_notice.v3_mcp.highlight_deprecated': 'Token statis trippi_ sudah usang',
  'system_notice.v3_mcp.highlight_tools': 'Perangkat dan prompt yang diperluas',
  'system_notice.v3_thankyou.title': 'Catatan pribadi dari saya',
  'system_notice.v3_thankyou.body':
    "Sebelum kamu lanjut — terima kasih. trippi.ai dimulai sebagai perencana untuk perjalanan saya sendiri, dan komunitas ini telah membentuknya lewat issue, terjemahan, ide, dan perjalanan nyata.\n\nSeiring trippi.ai berkembang, beberapa bagian mungkin menjadi layanan terhosting atau paket berbayar agar proyek ini terus membaik. Saya akan menjaga perubahan itu tetap jelas dan berfokus pada perencanaan perjalanan yang lebih baik.\n\n[Bergabunglah dengan komunitas di Discord](https://discord.gg/7Q6M6jDwzf)",
  'system_notice.v3014_whitespace_collision.title': 'Tindakan diperlukan: konflik akun pengguna',
  'system_notice.v3014_whitespace_collision.body':
    'Pembaruan 3.0.14 mendeteksi satu atau lebih konflik nama pengguna atau email yang disebabkan oleh spasi di awal atau akhir nilai yang tersimpan. Akun yang terpengaruh telah diganti nama secara otomatis. Periksa log server untuk baris yang dimulai dengan **[migration] WHITESPACE COLLISION** guna mengidentifikasi akun mana yang perlu ditinjau.',
};
export default system_notice;
