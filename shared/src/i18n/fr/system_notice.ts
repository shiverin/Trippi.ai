import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.welcome_v1.title': 'Bienvenue sur trippi.ai',
  'system_notice.welcome_v1.body':
    'Votre planificateur de voyage tout-en-un. Créez des itinéraires, partagez vos voyages et restez organisé — en ligne ou hors ligne.',
  'system_notice.welcome_v1.cta_label': 'Planifier un voyage',
  'system_notice.welcome_v1.hero_alt': "Destination de voyage pittoresque avec l'interface trippi.ai",
  'system_notice.welcome_v1.highlight_plan': 'Itinéraires jour par jour',
  'system_notice.welcome_v1.highlight_share': 'Collaborez avec vos partenaires',
  'system_notice.welcome_v1.highlight_offline': 'Fonctionne hors ligne sur mobile',
  'system_notice.dev_test_modal.title': '[Dev] Test notice',
  'system_notice.dev_test_modal.body': 'This is a dev-only test notice.',
  'system_notice.pager.prev': 'Avis précédent',
  'system_notice.pager.next': 'Avis suivant',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': "Aller à l'avis {n}",
  'system_notice.pager.position': 'Avis {current} sur {total}',
  'system_notice.v3_photos.title': 'Les photos ont bougé dans 3.0',
  'system_notice.v3_photos.body':
    "**Photos** dans le planificateur ont été supprimées. Tes photos sont en sécurité — trippi.ai n'a jamais modifié ta bibliothèque Immich ou Synology.\n\nLes photos vivent désormais dans l'addon **Journey**. Journey est optionnel — s'il n'est pas encore disponible, demande à ton admin de l'activer dans Admin → Modules.",
  'system_notice.v3_journey.title': 'Découvrez Journey — journal de voyage',
  'system_notice.v3_journey.body':
    'Documente tes voyages sous forme de récits enrichis avec chronologies, galeries photos et cartes interactives.',
  'system_notice.v3_journey.cta_label': 'Ouvrir Journey',
  'system_notice.v3_journey.highlight_timeline': 'Chronologie et galerie par jour',
  'system_notice.v3_journey.highlight_photos': 'Import depuis Immich ou Synology',
  'system_notice.v3_journey.highlight_share': 'Partage public — sans connexion requise',
  'system_notice.v3_journey.highlight_export': 'Export en livre photo PDF',
  'system_notice.v3_features.title': 'Plus de nouveautés en 3.0',
  'system_notice.v3_features.body': 'Quelques autres choses à savoir sur cette version.',
  'system_notice.v3_features.highlight_dashboard': 'Tableau de bord repensé mobile-first',
  'system_notice.v3_features.highlight_offline': 'Mode hors ligne complet en PWA',
  'system_notice.v3_features.highlight_search': 'Autocomplétion des lieux en temps réel',
  'system_notice.v3_features.highlight_import': 'Importer des lieux depuis KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP : mise à niveau OAuth 2.1',
  'system_notice.v3_mcp.body':
    "L'intégration MCP a été entièrement repensée. OAuth 2.1 est désormais la méthode d'authentification recommandée. Les tokens statiques (trippi_…) sont dépréciés et seront supprimés dans une future version.",
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 recommandé (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 scopes de permissions granulaires',
  'system_notice.v3_mcp.highlight_deprecated': 'Tokens statiques trippi_ dépréciés',
  'system_notice.v3_mcp.highlight_tools': 'Outils et prompts étendus',
  'system_notice.v3_thankyou.title': 'Un mot personnel de ma part',
  'system_notice.v3_thankyou.body':
    'Avant de continuer — merci. trippi.ai a commencé comme un planificateur pour mes propres voyages, et cette communauté l’a façonné avec des issues, des traductions, des idées et de vrais voyages.\n\nÀ mesure que trippi.ai grandit, certaines parties pourront devenir des services hébergés ou des offres payantes afin que le projet continue de s’améliorer. Je garderai ces changements clairs et centrés sur une meilleure planification des voyages.\n\n[Rejoins la communauté sur Discord](https://discord.gg/7Q6M6jDwzf)',
  'system_notice.v3014_whitespace_collision.title': 'Action requise : conflit de compte utilisateur',
  'system_notice.v3014_whitespace_collision.body':
    "La mise à niveau 3.0.14 a détecté un ou plusieurs conflits de nom d'utilisateur ou d'adresse e-mail causés par des espaces en début ou en fin de valeur dans les comptes enregistrés. Les comptes concernés ont été renommés automatiquement. Consultez les journaux du serveur pour les lignes commençant par **[migration] WHITESPACE COLLISION** afin d'identifier les comptes nécessitant une vérification.",
};
export default system_notice;
