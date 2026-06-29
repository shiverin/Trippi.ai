import {
  BookOpen,
  CalendarCheck,
  Check,
  FileText,
  FolderOpen,
  Globe2,
  Heart,
  ListChecks,
  LockKeyhole,
  type LucideIcon,
  Map,
  Plane,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react';

export interface LandingNavItem {
  label: string;
  href: string;
}

export interface WorkflowStep {
  step: string;
  title: string;
  description: string;
  Icon: LucideIcon;
}

export interface SpotlightFeature {
  id: string;
  title: string;
  description: string;
  details: string;
  image: string;
  imageAlt: string;
  accent: 'blue' | 'green' | 'amber' | 'pink' | 'cyan';
  Icon: LucideIcon;
}

export interface PricingTier {
  name: string;
  price: string;
  cadence?: string;
  description: string;
  features: string[];
  cta: string;
  featured?: boolean;
  Icon: LucideIcon;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  Icon: LucideIcon;
}

export const landingNavItems: LandingNavItem[] = [
  { label: 'Features', href: '#features' },
  { label: 'Showcase', href: '#showcase' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

export const workflowSteps: WorkflowStep[] = [
  {
    step: '1',
    title: 'Capture ideas',
    description: 'Drop ideas, places, and votes. AI groups them into options.',
    Icon: Sparkles,
  },
  {
    step: '2',
    title: 'Plan the days',
    description: 'Arrange days, times, and routes on the live map.',
    Icon: CalendarCheck,
  },
  {
    step: '3',
    title: 'Settle and go',
    description: 'Review costs, confirm bookings, and export your route.',
    Icon: Wallet,
  },
];

export const spotlightFeatures: SpotlightFeature[] = [
  {
    id: 'maps',
    title: 'Interactive maps',
    description: 'Explore, search, and pin places together in realtime.',
    details: 'A shared map, day-by-day itinerary, route stops, and place lists stay connected in one planning surface.',
    image: '/landing/trip-planner.png',
    imageAlt: 'Trippi trip planner with a live Tokyo map, itinerary days, and place list.',
    accent: 'blue',
    Icon: Map,
  },
  {
    id: 'sync',
    title: 'Realtime sync',
    description: 'See changes instantly as your group plans together.',
    details: 'Shared trips, collaborator avatars, live updates, and ownership-aware controls keep everyone aligned.',
    image: '/landing/dashboard.png',
    imageAlt: 'Trippi dashboard with trip overview cards and collaborative trip metadata.',
    accent: 'green',
    Icon: Users,
  },
  {
    id: 'budget',
    title: 'Budget tracking',
    description: 'Track shared costs and keep everyone in the loop.',
    details: 'Split expenses, see balances, review categories, and settle up before anyone forgets what happened.',
    image: '/landing/budget.png',
    imageAlt: 'Trippi costs screen with balances, shared spend, and settlement controls.',
    accent: 'green',
    Icon: Wallet,
  },
  {
    id: 'reservations',
    title: 'Reservations',
    description: 'Keep your bookings organized in one place.',
    details: 'Flights, stays, restaurants, documents, and route context live beside the plan they belong to.',
    image: '/landing/trip-planner.png',
    imageAlt: 'Trippi trip planner showing reservations and planning tabs.',
    accent: 'amber',
    Icon: CalendarCheck,
  },
  {
    id: 'packing',
    title: 'Packing lists',
    description: 'Smart packing lists for every traveler.',
    details: 'Turn trip context into lists your group can assign, check, and reuse.',
    image: '/landing/vacay.png',
    imageAlt: 'Trippi planning surface used as a companion visual for packing and trip preparation.',
    accent: 'amber',
    Icon: ListChecks,
  },
  {
    id: 'files',
    title: 'Files & docs',
    description: 'Store and share important trip documents.',
    details: 'Tickets, PDFs, notes, and uploads stay attached to the trip instead of vanishing into chat history.',
    image: '/landing/journey.png',
    imageAlt: 'Trippi journey screen used as a companion visual for stored travel context.',
    accent: 'pink',
    Icon: FolderOpen,
  },
  {
    id: 'atlas',
    title: 'Atlas',
    description: 'Mark everywhere you have been and dream of next.',
    details: 'A calm world map turns trips into a living travel record.',
    image: '/landing/atlas.png',
    imageAlt: 'Trippi Atlas world map with visited countries highlighted.',
    accent: 'cyan',
    Icon: Globe2,
  },
  {
    id: 'journey',
    title: 'Journey',
    description: 'Capture memories and relive your best moments.',
    details: 'Publishable timelines, photos, maps, and trip notes turn planning into a story worth keeping.',
    image: '/landing/journey.png',
    imageAlt: 'Trippi Journey memory timeline and map interface.',
    accent: 'pink',
    Icon: BookOpen,
  },
];

export const supportHighlights = [
  { title: 'Smart routes', description: 'AI-suggested routes that fit your style and time.', Icon: Route },
  { title: 'Vacay planning', description: 'Plan future getaways and keep ideas alive.', Icon: Plane },
  { title: 'Group permissions', description: 'Control who can edit, invite, or just view.', Icon: ShieldCheck },
  { title: 'Private by default', description: 'Your trips are yours. Invite-only access.', Icon: LockKeyhole },
];

export const pricingTiers: PricingTier[] = [
  {
    name: 'Community',
    price: '$0',
    description: 'Self-host Trippi, plan unlimited personal trips, and keep your data with you.',
    features: ['Self-hosted workspace', 'Unlimited personal trips', 'Open-source friendly'],
    cta: 'Start free',
    Icon: Server,
  },
  {
    name: 'Pro',
    price: '$8',
    cadence: '/mo',
    description: 'Hosted workspace with AI planning assist, realtime collaboration, and file storage.',
    features: ['Hosted workspace', 'AI planning assist', 'Realtime collaboration'],
    cta: 'Get started',
    featured: true,
    Icon: Globe2,
  },
  {
    name: 'Team',
    price: '$24',
    cadence: '/mo',
    description: 'Shared workspaces, group permissions, admin controls, and priority support.',
    features: ['Group workspaces', 'Admin controls', 'Priority support'],
    cta: 'Contact us',
    Icon: Users,
  },
];

export const faqItems: FaqItem[] = [
  {
    id: 'self-host',
    question: 'Can I self-host Trippi?',
    answer:
      'Yes. The Community path is for people who want to run Trippi themselves and keep trip data under their own control.',
    Icon: Server,
  },
  {
    id: 'groups',
    question: 'Does it work for group trips?',
    answer:
      'Yes. Trippi is built around shared trips, live edits, budgets, reservations, files, and invite-only collaboration.',
    Icon: Users,
  },
  {
    id: 'imports',
    question: 'Can I import bookings and files?',
    answer:
      'You can keep trip files, tickets, PDFs, notes, and reservations beside the itinerary so the context stays together.',
    Icon: FileText,
  },
  {
    id: 'privacy',
    question: 'Is my trip data private?',
    answer:
      'Trips are private by default. You choose who can view, edit, or collaborate, and self-hosting is available for tighter control.',
    Icon: LockKeyhole,
  },
];

export const footerLinks: LandingNavItem[] = [
  ...landingNavItems,
  { label: 'Support', href: 'mailto:support@trippi.ai' },
  { label: 'GitHub', href: 'https://github.com/shiverin/Trippi.ai' },
];

export const heroBadges = [
  { label: 'Self-hosted', Icon: Server },
  { label: 'Open-source friendly', Icon: Heart },
  { label: 'Private by default', Icon: LockKeyhole },
];

export const heroMetrics = [
  { label: 'Trip budget', value: '1.306,60 EUR', Icon: Wallet },
  { label: 'Reservations', value: '2 booked', Icon: CalendarCheck },
  { label: 'Group', value: '3 travelers', Icon: Users },
  { label: 'Files', value: '12 items', Icon: FolderOpen },
  { label: 'Route', value: '5 stops', Icon: Route },
];

export const featureProof = [
  { label: 'Open-source friendly', Icon: Check },
  { label: 'Self-hostable', Icon: Server },
  { label: 'Privacy first', Icon: ShieldCheck },
];
