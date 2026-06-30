import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Witaj w trippi.ai',
  'system_notice.welcome_v1.body':
    'Twój kompleksowy planer podróży. Twórz trasy, dziel się wycieczkami ze znajomymi i bądź zorganizowany — online i offline.',
  'system_notice.welcome_v1.cta_label': 'Zaplanuj podróż',
  'system_notice.welcome_v1.hero_alt': 'Malownicze miejsce z interfejsem planowania trippi.ai',
  'system_notice.welcome_v1.highlight_plan': 'Trasy dzień po dniu',
  'system_notice.welcome_v1.highlight_share': 'Współpraca z partnerami podróży',
  'system_notice.welcome_v1.highlight_offline': 'Działa offline na telefonie',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Poprzednie powiadomienie',
  'system_notice.pager.next': 'Następne powiadomienie',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Przejdź do powiadomienia {n}',
  'system_notice.pager.position': 'Powiadomienie {current} z {total}',
  'system_notice.v3_photos.title': 'Zdjęcia zostały przeniesione w 3.0',
  'system_notice.v3_photos.body':
    '**Zdjęcia** w Planerze Podróży zostały usunięte. Twoje zdjęcia są bezpieczne — trippi.ai nigdy nie modyfikował Twojej biblioteki Immich lub Synology.\n\nZdjęcia są teraz dostępne w dodatku **Journey**. Journey jest opcjonalny — jeśli jeszcze nie jest dostępny, poproś administratora o jego włączenie w Admin → Dodatki.',
  'system_notice.v3_journey.title': 'Poznaj Journey — dziennik podróży',
  'system_notice.v3_journey.body':
    'Dokumentuj swoje podróże jako bogatrze opowieści z osami czasu, galeriami i mapami interaktywnymi.',
  'system_notice.v3_journey.cta_label': 'Otwórz Journey',
  'system_notice.v3_journey.highlight_timeline': 'Dzienna oś czasu i galeria',
  'system_notice.v3_journey.highlight_photos': 'Import z Immich lub Synology',
  'system_notice.v3_journey.highlight_share': 'Udostępnij publicznie — bez logowania',
  'system_notice.v3_journey.highlight_export': 'Eksportuj jako książkę fotograficzną PDF',
  'system_notice.v3_features.title': 'Więcej nowości w 3.0',
  'system_notice.v3_features.body': 'Kilka innych rzeczy wartych uwagi w tym wydaniu.',
  'system_notice.v3_features.highlight_dashboard': 'Przeprojektowany pulpit mobile-first',
  'system_notice.v3_features.highlight_offline': 'Pełny tryb offline jako PWA',
  'system_notice.v3_features.highlight_search': 'Autouzupełnianie wyszukiwania miejsc',
  'system_notice.v3_features.highlight_import': 'Import miejsc z plików KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: aktualizacja OAuth 2.1',
  'system_notice.v3_mcp.body':
    'Integracja MCP została całkowicie przeprojektowana. OAuth 2.1 jest teraz zalecaną metodą uwierzytelniania. Statyczne tokeny (trippi_…) są przestarzałe i zostaną usunięte w przyszłej wersji.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 zalecany (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 szczegółowe zakresy uprawnień',
  'system_notice.v3_mcp.highlight_deprecated': 'Statyczne tokeny trippi_ przestarzałe',
  'system_notice.v3_mcp.highlight_tools': 'Rozszerzony zestaw narzędzi i promptów',
  'system_notice.v3_thankyou.title': 'Osobiste słowo ode mnie',
  'system_notice.v3_thankyou.body':
    "Zanim pójdziesz dalej — dziękuję. trippi.ai zaczęło się jako planer moich własnych podróży, a ta społeczność ukształtowała je przez zgłoszenia, tłumaczenia, pomysły i prawdziwe wyjazdy.\n\nWraz z rozwojem trippi.ai niektóre części mogą stać się usługami hostowanymi lub płatnymi planami, aby projekt mógł dalej się ulepszać. Będę jasno komunikować te zmiany i skupiać je na lepszym planowaniu podróży.\n\n[Dołącz do społeczności na Discordzie](https://discord.gg/7Q6M6jDwzf)",
  'system_notice.v3014_whitespace_collision.title': 'Wymagane działanie: konflikt konta użytkownika',
  'system_notice.v3014_whitespace_collision.body':
    'Aktualizacja 3.0.14 wykryła jeden lub więcej konfliktów nazwy użytkownika lub adresu e-mail spowodowanych spacjami na początku lub końcu przechowywanych wartości. Dotknięte konta zostały automatycznie przemianowane. Sprawdź logi serwera pod kątem wierszy zaczynających się od **[migration] WHITESPACE COLLISION**, aby zidentyfikować konta wymagające przeglądu.',
};
export default system_notice;
