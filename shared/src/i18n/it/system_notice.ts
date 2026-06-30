import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Benvenuto su trippi.ai',
  'system_notice.welcome_v1.body':
    'Il tuo pianificatore di viaggi tutto in uno. Crea itinerari, condividi viaggi con gli amici e rimani organizzato — online e offline.',
  'system_notice.welcome_v1.cta_label': 'Pianifica un viaggio',
  'system_notice.welcome_v1.hero_alt': "Destinazione di viaggio panoramica con l'interfaccia trippi.ai",
  'system_notice.welcome_v1.highlight_plan': 'Itinerari giorno per giorno',
  'system_notice.welcome_v1.highlight_share': 'Collabora con i tuoi compagni di viaggio',
  'system_notice.welcome_v1.highlight_offline': 'Funziona offline su mobile',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Avviso precedente',
  'system_notice.pager.next': 'Avviso successivo',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': "Vai all'avviso {n}",
  'system_notice.pager.position': 'Avviso {current} di {total}',
  'system_notice.v3_photos.title': 'Le foto sono spostate nella 3.0',
  'system_notice.v3_photos.body':
    '**Foto** nel Pianificatore di Viaggio sono state rimosse. Le tue foto sono al sicuro — trippi.ai non ha mai modificato la tua libreria Immich o Synology.\n\nLe foto ora si trovano nel componente aggiuntivo **Journey**. Journey è opzionale — se non è ancora disponibile, chiedi al tuo admin di abilitarlo in Admin → Addon.',
  'system_notice.v3_journey.title': 'Scopri Journey — diario di viaggio',
  'system_notice.v3_journey.body':
    'Documenta i tuoi viaggi come storie ricche con cronologie, gallerie fotografiche e mappe interattive.',
  'system_notice.v3_journey.cta_label': 'Apri Journey',
  'system_notice.v3_journey.highlight_timeline': 'Cronologia e galleria giornaliera',
  'system_notice.v3_journey.highlight_photos': 'Importa da Immich o Synology',
  'system_notice.v3_journey.highlight_share': 'Condividi pubblicamente — senza accesso',
  'system_notice.v3_journey.highlight_export': 'Esporta come libro fotografico PDF',
  'system_notice.v3_features.title': 'Altri punti salienti nel 3.0',
  'system_notice.v3_features.body': 'Altre novità da conoscere in questa versione.',
  'system_notice.v3_features.highlight_dashboard': 'Dashboard ridisegnata mobile-first',
  'system_notice.v3_features.highlight_offline': 'Modalità offline completa come PWA',
  'system_notice.v3_features.highlight_search': 'Completamento automatico luoghi in tempo reale',
  'system_notice.v3_features.highlight_import': 'Importa luoghi da file KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: aggiornamento OAuth 2.1',
  'system_notice.v3_mcp.body':
    "L'integrazione MCP è stata completamente rinnovata. OAuth 2.1 è ora il metodo di autenticazione consigliato. I token statici (trippi_…) sono deprecati e verranno rimossi in una versione futura.",
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 consigliato (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 scope di autorizzazione granulari',
  'system_notice.v3_mcp.highlight_deprecated': 'Token statici trippi_ deprecati',
  'system_notice.v3_mcp.highlight_tools': 'Strumenti e prompt estesi',
  'system_notice.v3_thankyou.title': 'Una nota personale da parte mia',
  'system_notice.v3_thankyou.body':
    'Prima di continuare — grazie. trippi.ai è nato come planner per i miei viaggi, e questa community lo ha plasmato con issue, traduzioni, idee e viaggi reali.\n\nMan mano che trippi.ai cresce, alcune parti potranno evolvere in servizi ospitati o piani a pagamento, così il progetto potrà continuare a migliorare. Terrò questi cambiamenti chiari e orientati a una migliore pianificazione dei viaggi.\n\n[Unisciti alla community su Discord](https://discord.gg/7Q6M6jDwzf)',
  'system_notice.v3014_whitespace_collision.title': 'Azione richiesta: conflitto di account utente',
  'system_notice.v3014_whitespace_collision.body':
    "L'aggiornamento 3.0.14 ha rilevato uno o più conflitti di nome utente o e-mail causati da spazi iniziali o finali nei valori memorizzati. Gli account interessati sono stati rinominati automaticamente. Controlla i log del server per le righe che iniziano con **[migration] WHITESPACE COLLISION** per identificare quali account richiedono revisione.",
};
export default system_notice;
