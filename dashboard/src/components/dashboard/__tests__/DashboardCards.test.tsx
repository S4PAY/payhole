import { render, screen } from '@testing-library/react';
import DashboardCards from '../DashboardCards';

describe('DashboardCards', () => {
  it('renders expected placeholder cards', () => {
    render(<DashboardCards />);

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(screen.getByText('Network Stats')).toBeInTheDocument();
    expect(screen.getByText('x402 Activity')).toBeInTheDocument();
    expect(screen.getByText('Creator Tips')).toBeInTheDocument();
  });
});

