import { fetchAnalytics } from '@/lib/analytics';

describe('fetchAnalytics', () => {
  it('throws when token is missing', async () => {
    await expect(fetchAnalytics('')).rejects.toThrow(/admin token/i);
  });

  it('returns metrics on success', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          metrics: {
            dau: 1500,
            paidUsers: 320,
            blockedRequests: 12000,
            revenue: 785.5,
          },
        }),
    } as Response);

    const result = await fetchAnalytics('token', fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/analytics',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      })
    );
    expect(result).toEqual({
      dau: 1500,
      paidUsers: 320,
      blockedRequests: 12000,
      revenue: 785.5,
    });
  });

  it('throws with error message when request fails', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      text: async () =>
        JSON.stringify({
          error: 'Unauthorized',
        }),
    } as Response);

    await expect(fetchAnalytics('token', fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /unauthorized/i
    );
  });
});


