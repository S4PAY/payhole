import Link from 'next/link';

const highlights = [
  {
    title: 'Zero-knowledge analytics',
    description: 'Telemetry stays on your nodes, giving you insights without surrendering user privacy.',
  },
  {
    title: 'Solana-native unlocks',
    description: 'Confirm x402 payments in seconds with USDC—no custodial middlemen or browser add-ons.',
  },
  {
    title: 'Network-wide protection',
    description: 'Ship auto-config profiles to every device and enforce PayHole rules at the edge.',
  },
];

const socialLinks = [
  {
    name: 'GitHub',
    href: 'https://github.com/S4PAY/payhole',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5 text-white transition group-hover:text-slate-900"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.522 2 12.055c0 4.435 2.865 8.204 6.839 9.533.5.094.683-.217.683-.483 0-.237-.009-.866-.014-1.7-2.782.61-3.37-1.366-3.37-1.366-.454-1.156-1.109-1.465-1.109-1.465-.908-.622.069-.61.069-.61 1.004.07 1.533 1.04 1.533 1.04.892 1.544 2.341 1.097 2.91.838.092-.655.35-1.097.636-1.35-2.221-.254-4.555-1.124-4.555-5.004 0-1.105.39-2.005 1.029-2.712-.103-.254-.446-1.276.098-2.66 0 0 .84-.27 2.75 1.035a9.39 9.39 0 0 1 2.505-.341c.85.004 1.705.116 2.506.341 1.91-1.305 2.748-1.035 2.748-1.035.546 1.384.203 2.406.1 2.66.64.707 1.027 1.607 1.027 2.712 0 3.89-2.338 4.747-4.566 4.996.36.311.681.923.681 1.86 0 1.342-.012 2.425-.012 2.756 0 .268.18.581.688.482A10.06 10.06 0 0 0 22 12.055C22 6.522 17.523 2 12 2Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    name: 'X (Twitter)',
    href: 'https://x.com/payhole_x402',
    icon: (
      <svg
        aria-hidden="true"
        focusable="false"
        className="h-5 w-5 text-white transition group-hover:text-slate-900"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M3 3h4.293l4.482 6.59 4.9-6.59H21l-7.16 9.624L21 21h-4.293l-4.631-6.827L6.9 21H3l7.354-9.957L3 3Z" />
      </svg>
    ),
  },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-indigo-500/40 via-purple-500/30 to-slate-900/80 p-10 shadow-[0_20px_60px_rgba(15,23,42,0.45)]">
      <div className="absolute -top-24 right-0 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="absolute -bottom-16 left-10 h-48 w-48 rounded-full bg-indigo-500/30 blur-3xl" />
      <div className="relative z-10 max-w-3xl space-y-6">
        <span className="badge-soft">The web should pay you peace</span>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
          Own your browsing perimeter with privacy-first payments.
        </h1>
        <p className="max-w-2xl text-base text-slate-100/80 md:text-lg">
          PayHole intercepts ads, challenges intrusive trackers, and verifies premium content with lightning-fast
          Solana settlements. Connect your wallet to unlock proxy onboarding, analytics, and creator tooling.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="#connect"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            Connect Wallet
            <span aria-hidden className="text-slate-500">
              →
            </span>
          </Link>
          <Link
            href="#proxy"
            className="inline-flex items-center gap-2 rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            View Proxy Status
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-4 text-sm text-slate-100/70">
          <span className="uppercase tracking-wide text-xs text-slate-200/60">Follow PayHole</span>
          <div className="flex items-center gap-2">
            {socialLinks.map((link) => (
              <Link
                key={link.name}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white hover:text-slate-900 hover:shadow-lg"
                aria-label={link.name}
              >
                {link.icon}
                <span className="sr-only">{link.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div className="relative z-10 mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((item) => (
          <div key={item.title} className="surface-panel p-6 text-slate-100/90">
            <h3 className="text-base font-semibold text-white">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-200/80">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

