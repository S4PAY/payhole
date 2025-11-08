const cards = [
  {
    title: 'Network Stats',
    description: 'Track intercepted domains, DoH latency, and blocked trackers in real time.',
  },
  {
    title: 'x402 Activity',
    description: 'Review paywall requests, replay invoices, and verify Solana settlement proofs.',
  },
  {
    title: 'Creator Tips',
    description: 'Monitor direct payouts to publishers and configure automated tipping policies.',
  },
];

export default function DashboardCards() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <article
          key={card.title}
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
          <p className="mt-2 text-sm text-slate-600">{card.description}</p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            View details →
          </button>
        </article>
      ))}
    </section>
  );
}

