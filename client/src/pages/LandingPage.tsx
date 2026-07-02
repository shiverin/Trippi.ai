import { ArrowRight, Bell, ChevronDown, Compass, Linkedin, Mail, Menu, Moon, PlayCircle, X } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/landing.css';
import {
  faqItems,
  featureProof,
  footerLinks,
  heroMetrics,
  landingNavItems,
  pricingTiers,
  spotlightFeatures,
  supportHighlights,
  workflowSteps,
} from './landing/landingContent';
import { useLanding } from './landing/useLanding';

function Brand({ light = false }: { light?: boolean }) {
  return (
    <span className={`landing-brand ${light ? 'landing-brand--light' : ''}`} aria-label="trippi">
      <img
        src={light ? '/brand/trippi-icon-light.png' : '/brand/trippi-icon.png'}
        alt=""
        className="landing-brand__icon"
      />
      <span>trippi</span>
    </span>
  );
}

function LandingNav({
  mobileNavOpen,
  setMobileNavOpen,
  closeMobileNav,
}: {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  closeMobileNav: () => void;
}) {
  return (
    <header className="landing-nav-wrap">
      <nav className="landing-nav" aria-label="Landing page navigation">
        <a className="landing-nav__brand" href="#top" onClick={closeMobileNav}>
          <Brand />
        </a>
        <div className="landing-nav__links">
          {landingNavItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </div>
        <div className="landing-nav__actions">
          <Link className="landing-btn landing-btn--ghost" to="/login">
            Sign In
          </Link>
          <Link className="landing-btn landing-btn--primary" to="/register">
            Get Started
          </Link>
          <button
            className="landing-icon-btn landing-nav__menu"
            aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileNavOpen}
            aria-controls="landing-mobile-menu"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      {mobileNavOpen && (
        <div className="landing-mobile-menu" id="landing-mobile-menu">
          {landingNavItems.map((item) => (
            <a key={item.href} href={item.href} onClick={closeMobileNav}>
              {item.label}
            </a>
          ))}
          <Link to="/login" onClick={closeMobileNav}>
            Sign In
          </Link>
        </div>
      )}
    </header>
  );
}

function ProductBrowser({ className = '' }: { className?: string }) {
  return (
    <div className={`landing-browser ${className}`}>
      <div className="landing-browser__top">
        <span className="landing-dot landing-dot--red" />
        <span className="landing-dot landing-dot--amber" />
        <span className="landing-dot landing-dot--green" />
        <div className="landing-browser__address">www.trippi.lol/tokyo</div>
      </div>
      <div className="landing-browser__chrome">
        <div className="landing-browser__crumb">
          <Compass size={17} />
          <strong>trippi</strong>
          <span>/</span>
          <span>Tokyo</span>
        </div>
        <div className="landing-browser__tools">
          <button>Share</button>
          <Moon size={15} />
          <Bell size={15} />
          <span className="landing-avatar">A</span>
        </div>
      </div>
      <div className="landing-browser__media">
        <img
          src="/landing/trip-planner.png"
          alt="Trippi AI trip planner showing a live Tokyo map and itinerary sidebar."
        />
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <section className="landing-hero" id="top">
      <div className="landing-hero__copy">
        <div className="landing-hero__badge">
          <Compass size={18} />
          <span>Trippi.ai travel planner</span>
        </div>
        <h1>Your trippi, our troppi</h1>
        <p>
          Plan smarter with AI help, live maps, shared budgets, reservations, files, and routes that stay in sync.
          Less confusion, more fun.
        </p>
        <div className="landing-hero__actions">
          <Link className="landing-btn landing-btn--primary landing-btn--large" to="/register">
            <Compass size={19} />
            Start planning
          </Link>
          <a className="landing-btn landing-btn--ghost landing-btn--large" href="#showcase">
            <PlayCircle size={19} />
            Watch demo
          </a>
        </div>
      </div>
      <div className="landing-hero__visual" aria-label="Trippi product preview">
        <ProductBrowser className="landing-hero-browser" />
        <div className="landing-metric-dock">
          {heroMetrics.map(({ label, value, Icon }) => (
            <div key={label} className="landing-metric">
              <Icon size={18} />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="landing-section landing-workflow" id="showcase">
      <div className="landing-section__heading landing-section__heading--center">
        <h2>From idea to itinerary, together</h2>
        <p>Turn a rough group plan into shared days, places, costs, files, and routes that everyone can edit.</p>
      </div>
      <div className="landing-workflow__grid">
        <div className="landing-workflow__steps">
          {workflowSteps.map(({ step, title, description, Icon }, index) => (
            <article key={title} className={index === 0 ? 'is-active' : ''}>
              <span className="landing-step-number">{step}</span>
              <span className="landing-step-icon">
                <Icon size={24} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="landing-workflow__surface">
          <ProductBrowser />
          <aside className="landing-workflow-panel landing-workflow-panel--budget">
            <div>
              <span>Shared budget</span>
              <strong>EUR 1.306,60</strong>
            </div>
            <div className="landing-budget-bars">
              <span />
              <span />
              <span />
            </div>
            <a href="#pricing">View budget</a>
          </aside>
          <aside className="landing-workflow-panel landing-workflow-panel--files">
            <span>Files & docs</span>
            <strong>Tokyo Tickets.pdf</strong>
            <strong>Hotel Check-in Info</strong>
          </aside>
        </div>
      </div>
      <div className="landing-workflow__strip">
        {[
          ['Live map', 'See your plan come to life.'],
          ['Realtime sync', 'Everyone sees updates instantly.'],
          ['Shared budget', 'Track who paid what.'],
          ['Reservations', 'Keep every booking in one place.'],
          ['Files', 'Store notes and tickets.'],
          ['Route export', 'Share offline itineraries.'],
        ].map(([title, description]) => (
          <div key={title}>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeatureSection({
  activeFeature,
  activeFeatureId,
  setActiveFeatureId,
}: Pick<ReturnType<typeof useLanding>, 'activeFeature' | 'activeFeatureId' | 'setActiveFeatureId'>) {
  return (
    <section className="landing-section landing-features" id="features">
      <div className="landing-features__copy">
        <div className="landing-section__heading">
          <h2>Everything you need, nothing you don't.</h2>
          <p>Powerful tools for planning, traveling, and remembering trips as a group.</p>
        </div>
        <div className="landing-feature-list" role="tablist" aria-label="Landing feature spotlight">
          {spotlightFeatures.map(({ id, title, description, Icon, accent }) => (
            <button
              key={id}
              className={`landing-feature-button landing-accent-${accent} ${activeFeatureId === id ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeFeatureId === id}
              onClick={() => setActiveFeatureId(id)}
            >
              <span>
                <Icon size={21} />
              </span>
              <strong>{title}</strong>
              <small>{description}</small>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      </div>
      <div className="landing-feature-showcase">
        <div className="landing-feature-showcase__top">
          <div>
            <strong>{activeFeature.title}</strong>
            <span>{activeFeature.details}</span>
          </div>
          <a href="#showcase">
            Explore showcase <ArrowRight size={15} />
          </a>
        </div>
        <div className="landing-feature-showcase__image">
          <img src={activeFeature.image} alt={activeFeature.imageAlt} />
        </div>
        <div className="landing-feature-dots" aria-hidden="true">
          {spotlightFeatures.slice(0, 4).map((feature) => (
            <span key={feature.id} className={activeFeatureId === feature.id ? 'is-active' : ''} />
          ))}
        </div>
        <div className="landing-support-grid">
          {supportHighlights.map(({ title, description, Icon }) => (
            <article key={title}>
              <Icon size={22} />
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="landing-proof-bar">
        <strong>Packed with features, built as one travel planner, and ready for LLM agents.</strong>
        <div>
          {featureProof.map(({ label, Icon }) => (
            <span key={label}>
              <Icon size={15} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section className="landing-section landing-pricing" id="pricing">
      <div className="landing-section__heading landing-section__heading--center">
        <h2>Choose how you want to travel</h2>
        <p>Start with the basics, upgrade into a richer planner, or unlock autonomous LLM-agent workflows.</p>
      </div>
      <div className="landing-pricing__grid">
        {pricingTiers.map(({ name, price, cadence, description, features, cta, ctaHref, featured, Icon }) => (
          <article key={name} className={`landing-price-card ${featured ? 'is-featured' : ''}`}>
            {featured && <span className="landing-price-card__flag">Most popular</span>}
            <Icon size={28} />
            <h3>{name}</h3>
            <div className="landing-price-card__price">
              <strong>{price}</strong>
              {cadence && <span>{cadence}</span>}
            </div>
            <p>{description}</p>
            <ul>
              {features.map((feature) => (
                <li key={feature}>
                  <span className="landing-check-icon">
                    <ArrowRight size={13} />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            <Link className={`landing-btn ${featured ? 'landing-btn--primary' : 'landing-btn--outline'}`} to={ctaHref}>
              {cta}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}

function FaqSection({ openFaqId, toggleFaq }: Pick<ReturnType<typeof useLanding>, 'openFaqId' | 'toggleFaq'>) {
  return (
    <section className="landing-section landing-faq" id="faq">
      <div className="landing-section__heading landing-section__heading--center">
        <h2>Questions before takeoff</h2>
      </div>
      <div className="landing-faq__grid">
        {faqItems.map(({ id, question, answer, Icon }) => {
          const open = openFaqId === id;
          return (
            <article key={id} className={open ? 'is-open' : ''}>
              <button type="button" aria-expanded={open} aria-controls={`${id}-answer`} onClick={() => toggleFaq(id)}>
                <Icon size={21} />
                <span>{question}</span>
                <ChevronDown size={20} />
              </button>
              <p id={`${id}-answer`} hidden={!open}>
                {answer}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer__brand">
        <Brand light />
        <p>Collaborative travel planning, one trip at a time.</p>
        <div>
          <a href="https://www.linkedin.com/in/zhaoshizhen2004/" aria-label="Trippi on LinkedIn">
            <Linkedin size={18} />
          </a>
          <a href="mailto:zhaoshizhen04@gmail.com" aria-label="Email Trippi support">
            <Mail size={18} />
          </a>
        </div>
      </div>
      <nav aria-label="Footer navigation">
        {footerLinks.map((link) => (
          <a key={`${link.href}-${link.label}`} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <div className="landing-footer__bottom">
        <span>Copyright 2026 trippi.lol</span>
        <span>AI trip planning for people, groups, and travel agents.</span>
      </div>
    </footer>
  );
}

export default function LandingPage(): React.ReactElement {
  const {
    activeFeature,
    activeFeatureId,
    closeMobileNav,
    mobileNavOpen,
    openFaqId,
    setActiveFeatureId,
    setMobileNavOpen,
    toggleFaq,
  } = useLanding();

  return (
    <main className="trippi-landing">
      <LandingNav mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen} closeMobileNav={closeMobileNav} />
      <HeroSection />
      <WorkflowSection />
      <FeatureSection
        activeFeature={activeFeature}
        activeFeatureId={activeFeatureId}
        setActiveFeatureId={setActiveFeatureId}
      />
      <PricingSection />
      <FaqSection openFaqId={openFaqId} toggleFaq={toggleFaq} />
      <section className="landing-final-cta" aria-label="Start planning">
        <div>
          <h2>Ready to turn the group chat into a trip?</h2>
          <p>Bring everyone into one live itinerary before the next idea disappears.</p>
        </div>
        <Link className="landing-btn landing-btn--primary landing-btn--large" to="/register">
          Start planning
          <ArrowRight size={18} />
        </Link>
      </section>
      <LandingFooter />
    </main>
  );
}
