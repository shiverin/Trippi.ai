import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LandingPage from './LandingPage';

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

describe('LandingPage', () => {
  it('renders the hero, navigation, and primary calls to action', () => {
    renderLanding();

    expect(screen.getByRole('heading', { name: /your trippi, our troppi/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /get started/i })[0]).toHaveAttribute('href', '/login');
    expect(screen.getAllByRole('link', { name: /start planning/i })[0]).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /watch demo/i })).toHaveAttribute('href', '#showcase');
  });

  it('switches the feature spotlight when a feature is selected', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('tab', { name: /budget tracking/i }));

    expect(screen.getByText(/split expenses/i)).toBeInTheDocument();
    expect(screen.getByAltText(/costs screen/i)).toBeInTheDocument();
  });

  it('toggles FAQ answers', () => {
    renderLanding();

    const privacyQuestion = screen.getByRole('button', { name: /is my trip data private/i });
    fireEvent.click(privacyQuestion);

    expect(screen.getByText(/trips are private by default/i)).toBeInTheDocument();
  });

  it('opens the mobile navigation menu', () => {
    renderLanding();

    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));

    expect(screen.getAllByRole('link', { name: /^pricing$/i }).length).toBeGreaterThan(1);
  });

  it('renders footer contact links to the owner email and LinkedIn', () => {
    renderLanding();

    const supportLinks = screen.getAllByRole('link', { name: /support/i });
    expect(supportLinks[supportLinks.length - 1]).toHaveAttribute('href', 'mailto:zhaoshizhen04@gmail.com');
    expect(screen.getByRole('link', { name: /trippi on linkedin/i })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/zhaoshizhen2004/'
    );
    expect(screen.getByRole('link', { name: /^linkedin$/i })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/zhaoshizhen2004/'
    );
  });
});
