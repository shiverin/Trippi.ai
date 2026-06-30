import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Üdvözöl a trippi.ai',
  'system_notice.welcome_v1.body':
    'Az összes az egyben utazástervező. Készítsen útvonalakat, ossza meg az utakat barátaival, és maradjon szervezett — online és offline.',
  'system_notice.welcome_v1.cta_label': 'Utazás tervezése',
  'system_notice.welcome_v1.hero_alt': 'Festői úticél trippi.ai tervező felülettel',
  'system_notice.welcome_v1.highlight_plan': 'Napi útvonalak minden utazáshoz',
  'system_notice.welcome_v1.highlight_share': 'Együttműködés utazótársakkal',
  'system_notice.welcome_v1.highlight_offline': 'Mobilon offline is működik',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Előző értesítés',
  'system_notice.pager.next': 'Következő értesítés',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': '{n}. értesítésre ugrás',
  'system_notice.pager.position': '{current}/{total}. értesítés',
  'system_notice.v3_photos.title': 'A fotók helye megváltozott 3.0-ban',
  'system_notice.v3_photos.body':
    'Az útiterv-tervező **Fényképek** lapja eltávolításra került. Fényképeid biztonságban vannak — trippi.ai soha nem módosította Immich vagy Synology könyvtáradat.\n\nA fényképek mostantól a **Journey** bővítményben élnek. A Journey opcionális — ha még nem elérhető, kérd meg a rendszergazdát, hogy engedélyezze Admin → Bővítmények alatt.',
  'system_notice.v3_journey.title': 'Ismerje meg a Journey-t — útinnapló',
  'system_notice.v3_journey.body':
    'Dokumentáld utazazsaid gazdag történetekként idővonalakkal, fotgáriákkal és interaktív térképekkel.',
  'system_notice.v3_journey.cta_label': 'Journey megnyitása',
  'system_notice.v3_journey.highlight_timeline': 'Napi idővonal és galéria',
  'system_notice.v3_journey.highlight_photos': 'Import Immich-ből vagy Synology-ból',
  'system_notice.v3_journey.highlight_share': 'Nyilvános megosztás — bejelentkezés nélkül',
  'system_notice.v3_journey.highlight_export': 'Exportálás PDF fotkönyvként',
  'system_notice.v3_features.title': 'További újdonságok a 3.0-ban',
  'system_notice.v3_features.body': 'Néhány további dolog, amit érdemes tudni erről a kiadásról.',
  'system_notice.v3_features.highlight_dashboard': 'Mobile-first irmütébla újratervezve',
  'system_notice.v3_features.highlight_offline': 'Teljes offline mód PWA-ként',
  'system_notice.v3_features.highlight_search': 'Valós idejű helykeresés-kiegészítés',
  'system_notice.v3_features.highlight_import': 'Helyek importálása KMZ/KML fájlokból',
  'system_notice.v3_mcp.title': 'MCP: OAuth 2.1 frissítés',
  'system_notice.v3_mcp.body':
    'Az MCP integráció teljesen megújult. Az OAuth 2.1 mostantól az ajánlott hitelesítési módszer. A statikus tokenek (trippi_…) elavultak és egy jövőbeli kiadásban eltávolításra kerülnek.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 ajánlott (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 részletes engedélyezési hatókör',
  'system_notice.v3_mcp.highlight_deprecated': 'Statikus trippi_ tokenek elavultak',
  'system_notice.v3_mcp.highlight_tools': 'Bővített eszközkészlet és promptok',
  'system_notice.v3_thankyou.title': 'Egy személyes gondolat tőlem',
  'system_notice.v3_thankyou.body':
    'Mielőtt továbbmennél — köszönöm. A trippi.ai a saját utazásaimhoz készült tervezőként indult, és ez a közösség hibajegyekkel, fordításokkal, ötletekkel és valódi utazásokkal formálta.\n\nAhogy a trippi.ai növekszik, egyes részei hosztolt szolgáltatásokká vagy fizetős csomagokká fejlődhetnek, hogy a projekt tovább javulhasson. Ezeket a változásokat világosan, a jobb utazástervezésre figyelve fogom kommunikálni.\n\n[Csatlakozz a közösséghez a Discordon](https://discord.gg/7Q6M6jDwzf)',
  'system_notice.v3014_whitespace_collision.title': 'Szükséges beavatkozás: felhasználói fiókütközés',
  'system_notice.v3014_whitespace_collision.body':
    'A 3.0.14-es frissítés egy vagy több felhasználónév- vagy e-mail-ütközést észlelt, amelyeket a tárolt értékek elején vagy végén lévő szóközök okoztak. Az érintett fiókok automatikusan át lettek nevezve. Ellenőrizze a szervernaplókat a **[migration] WHITESPACE COLLISION** kezdetű soroknál a felülvizsgálatot igénylő fiókok azonosításához.',
};
export default system_notice;
