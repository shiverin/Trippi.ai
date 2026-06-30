import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Vítejte v trippi.ai',
  'system_notice.welcome_v1.body':
    'Váš kompletní plánovač cest. Vytvářejte itineráře, sdílejte výlety s přáteli a zůstaňte organizovaní — online i offline.',
  'system_notice.welcome_v1.cta_label': 'Naplánovat cestu',
  'system_notice.welcome_v1.hero_alt': 'Malebné cestovní místo s rozhraním trippi.ai',
  'system_notice.welcome_v1.highlight_plan': 'Denní itineráře pro každou cestu',
  'system_notice.welcome_v1.highlight_share': 'Spolupráce s cestovními partnery',
  'system_notice.welcome_v1.highlight_offline': 'Funguje offline na mobilu',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Předchozí oznámení',
  'system_notice.pager.next': 'Další oznámení',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Přejít na oznámení {n}',
  'system_notice.pager.position': 'Oznámení {current} z {total}',
  'system_notice.v3_photos.title': 'Fotografie přesunuty ve verzi 3.0',
  'system_notice.v3_photos.body':
    '**Fotografie** v Plánovacím nástroji byly odebrány. Vaše fotografie jsou v bezpečí — trippi.ai nikdy neupravoval vaši knihovnu Immich nebo Synology.\n\nFotografie jsou nyní dostupné v doplňku **Journey**. Journey je volitelný — pokud ještě není k dispozici, požádejte svého správce, aby ho aktivoval v Admin → Doplňky.',
  'system_notice.v3_journey.title': 'Poznejte Journey — cest. denník',
  'system_notice.v3_journey.body':
    'Dokumentujte své cesty jako bohaté příběhy s časovnicemi, galeriemi fotek a interaktivními mapami.',
  'system_notice.v3_journey.cta_label': 'Otevřít Journey',
  'system_notice.v3_journey.highlight_timeline': 'Denní časovnice a galerie',
  'system_notice.v3_journey.highlight_photos': 'Import z Immich nebo Synology',
  'system_notice.v3_journey.highlight_share': 'Sdílet veřejně — bez přihlašování',
  'system_notice.v3_journey.highlight_export': 'Export jako PDF fotokniha',
  'system_notice.v3_features.title': 'Další novinky ve verzi 3.0',
  'system_notice.v3_features.body': 'Několik dalších změn, které stojí za pozornost.',
  'system_notice.v3_features.highlight_dashboard': 'Předesign dashboardu mobile-first',
  'system_notice.v3_features.highlight_offline': 'Plný offline režim jako PWA',
  'system_notice.v3_features.highlight_search': 'Autodoplňování vyhledávání míst',
  'system_notice.v3_features.highlight_import': 'Import míst ze souborů KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: aktualizace OAuth 2.1',
  'system_notice.v3_mcp.body':
    'Integrace MCP byla kompletně přepracována. OAuth 2.1 je nyní doporučenou metodou ověřování. Statické tokeny (trippi_…) jsou zastaralé a budou v budoucí verzi odstraněny.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 doporučeno (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 jemnozrnných oprávnění',
  'system_notice.v3_mcp.highlight_deprecated': 'Statické tokeny trippi_ zastaralé',
  'system_notice.v3_mcp.highlight_tools': 'Rozšířená sada nástrojů a promptů',
  'system_notice.v3_thankyou.title': 'Osobní slovo ode mě',
  'system_notice.v3_thankyou.body':
    "Než budete pokračovat — děkuji. trippi.ai začal jako plánovač pro moje vlastní cesty a tahle komunita ho formovala hlášením chyb, překlady, nápady i skutečnými cestami.\n\nJak trippi.ai roste, některé části se mohou vyvinout v hostované služby nebo placené tarify, aby se projekt mohl dál zlepšovat. Tyto změny budu komunikovat jasně a se zaměřením na lepší plánování cest.\n\n[Přidej se ke komunitě na Discordu](https://discord.gg/7Q6M6jDwzf)",
  'system_notice.v3014_whitespace_collision.title': 'Vyžadována akce: konflikt uživatelského účtu',
  'system_notice.v3014_whitespace_collision.body':
    'Aktualizace 3.0.14 zjistila jeden nebo více konfliktů uživatelského jména nebo e-mailu způsobených mezerami na začátku nebo konci uložených hodnot. Dotčené účty byly automaticky přejmenovány. Zkontrolujte protokoly serveru na řádky začínající **[migration] WHITESPACE COLLISION** a zjistěte, které účty vyžadují kontrolu.',
};
export default system_notice;
