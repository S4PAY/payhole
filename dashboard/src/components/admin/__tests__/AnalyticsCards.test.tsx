import { render, screen } from '@testing-library/react';
import AnalyticsCards from '@/components/admin/AnalyticsCards';

const mockMetrics = {
  dau: 12500,
  paidUsers: 512,
  blockedRequests: 780000,
  revenue: {
    daily: 842.5,
    monthly: 26875.1,
    currency: 'USDC',
  },
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('AnalyticsCards', () => {
  it('renders key metrics', () => {
    render(<AnalyticsCards metrics={mockMetrics} />);

    expect(screen.getByTestId('metric-dau')).toHaveTextContent('12.5K');
    expect(screen.getByTestId('metric-paid-users')).toHaveTextContent('512');
    expect(screen.getByTestId('metric-blocked-requests')).toHaveTextContent('780.0K');
    expect(screen.getByTestId('metric-revenue')).toHaveTextContent('842.5');
  });
});


