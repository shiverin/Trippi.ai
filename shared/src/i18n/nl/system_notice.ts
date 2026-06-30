import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Welkom bij trippi.ai',
  'system_notice.welcome_v1.body':
    "Jouw alles-in-één reisplanner. Maak reisschema's, deel trips met vrienden en blijf georganiseerd — online en offline.",
  'system_notice.welcome_v1.cta_label': 'Reis plannen',
  'system_notice.welcome_v1.hero_alt': 'Schilderachtige reisbestemming met trippi.ai interface',
  'system_notice.welcome_v1.highlight_plan': "Dag-voor-dag reisschema's",
  'system_notice.welcome_v1.highlight_share': 'Samenwerken met reisgezelschap',
  'system_notice.welcome_v1.highlight_offline': 'Werkt offline op mobiel',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Vorige melding',
  'system_notice.pager.next': 'Volgende melding',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Ga naar melding {n}',
  'system_notice.pager.position': 'Melding {current} van {total}',
  'system_notice.v3_photos.title': "Foto's zijn verplaatst in 3.0",
  'system_notice.v3_photos.body':
    "**Foto's** in de Reisplanner zijn verwijderd. Je foto's zijn veilig — trippi.ai heeft je Immich- of Synology-bibliotheek nooit gewijzigd.\n\nFoto's leven nu in de **Journey**-addon. Journey is optioneel — als het nog niet beschikbaar is, vraag je admin het te activeren via Admin → Addons.",
  'system_notice.v3_journey.title': 'Maak kennis met Journey — reisdagboek',
  'system_notice.v3_journey.body':
    'Documenteer je reizen als rijke verhalen met tijdlijnen, fotogalerijen en interactieve kaarten.',
  'system_notice.v3_journey.cta_label': 'Journey openen',
  'system_notice.v3_journey.highlight_timeline': 'Dag-voor-dag tijdlijn & galerij',
  'system_notice.v3_journey.highlight_photos': 'Importeer van Immich of Synology',
  'system_notice.v3_journey.highlight_share': 'Openbaar delen — geen login vereist',
  'system_notice.v3_journey.highlight_export': 'Exporteer als PDF-fotoboek',
  'system_notice.v3_features.title': 'Meer hoogtepunten in 3.0',
  'system_notice.v3_features.body': 'Nog een paar dingen die het weten waard zijn in deze release.',
  'system_notice.v3_features.highlight_dashboard': 'Mobile-first dashboard herontwerp',
  'system_notice.v3_features.highlight_offline': 'Volledige offline modus als PWA',
  'system_notice.v3_features.highlight_search': 'Realtime plaatsautocomplete',
  'system_notice.v3_features.highlight_import': 'Importeer plaatsen uit KMZ/KML-bestanden',
  'system_notice.v3_mcp.title': 'MCP: OAuth 2.1-upgrade',
  'system_notice.v3_mcp.body':
    'De MCP-integratie is volledig vernieuwd. OAuth 2.1 is nu de aanbevolen authenticatiemethode. Statische tokens (trippi_…) zijn verouderd en worden verwijderd in een toekomstige versie.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 aanbevolen (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 gedetailleerde toestemmingsscopes',
  'system_notice.v3_mcp.highlight_deprecated': 'Statische trippi_-tokens verouderd',
  'system_notice.v3_mcp.highlight_tools': 'Uitgebreide tools & prompts',
  'system_notice.v3_thankyou.title': 'Een persoonlijk woord van mij',
  'system_notice.v3_thankyou.body':
    "Voordat je verdergaat — bedankt. trippi.ai begon als een planner voor mijn eigen reizen, en deze community heeft het gevormd met issues, vertalingen, ideeën en echte reizen.\n\nNaarmate trippi.ai groeit, kunnen sommige onderdelen zich ontwikkelen tot gehoste diensten of betaalde plannen zodat het project kan blijven verbeteren. Ik houd die veranderingen duidelijk en gericht op betere reisplanning.\n\n[Sluit je aan bij de community op Discord](https://discord.gg/7Q6M6jDwzf)",
  'system_notice.v3014_whitespace_collision.title': 'Actie vereist: gebruikersaccountconflict',
  'system_notice.v3014_whitespace_collision.body':
    'De 3.0.14-upgrade heeft één of meer conflicten in gebruikersnaam of e-mailadres gedetecteerd, veroorzaakt door spaties aan het begin of einde van opgeslagen waarden. Getroffen accounts zijn automatisch hernoemd. Controleer de serverlogboeken op regels die beginnen met **[migration] WHITESPACE COLLISION** om te achterhalen welke accounts moeten worden beoordeeld.',
};
export default system_notice;
