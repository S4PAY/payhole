import { render, screen } from '@testing-library/react';

import Hero from '@/components/dashboard/Hero';

describe('Hero', () => {
  it('renders branded social links for GitHub and X', () => {
    render(<Hero />);

    const githubLink = screen.getByRole('link', { name: /GitHub/i });
    expect(githubLink).toHaveAttribute('href', 'https://github.com/S4PAY/payhole');

    const xLink = screen.getByRole('link', { name: /X \(Twitter\)/i });
    expect(xLink).toHaveAttribute('href', 'https://x.com/payhole_x402');
  });
});

