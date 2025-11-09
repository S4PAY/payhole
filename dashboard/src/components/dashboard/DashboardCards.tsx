import Link from 'next/link';

const cards = [
  {
    title: 'Network Stats',
    description: 'Track intercepted domains, DoH latency, and blocked trackers in real time.',
    href: '/admin/analytics',
  },
  {
    title: 'x402 Activity',
    description: 'Review paywall requests, replay invoices, and verify Solana settlement proofs.',
    href: '/admin',
  },
  {
    title: 'Creator Tips',
    description: 'Monitor direct payouts to publishers and configure automated tipping policies.',
    href: '/admin',
  },
];

export default function DashboardCards() {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <article
          key={card.title}
          className="surface-panel group relative overflow-hidden p-5 transition hover:-translate-y-1 hover:shadow-2xl"
        >
          <div className="absolute inset-0 opacity-0 transition group-hover:opacity-100 bg-gradient-to-br from-indigo-500/30 via-transparent to-indigo-400/10" />
          <div className="relative z-10 space-y-2 text-slate-100">
            <h2 className="text-lg font-semibold text-white">{card.title}</h2>
            <p className="text-sm text-slate-100/75">{card.description}</p>
            <Link
              href={card.href}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition group-hover:text-white"
            >
              View details
              <span aria-hidden>→</span>
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}

